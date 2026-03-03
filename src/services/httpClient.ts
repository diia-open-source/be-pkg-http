import { Span, SpanKind, SpanStatusCode, context, trace } from '@opentelemetry/api'
import { SEMATTRS_MESSAGING_SYSTEM, SemanticAttributes } from '@opentelemetry/semantic-conventions'
import axios, { AxiosError } from 'axios'

import { MetricsService, RequestMechanism, RequestStatus, TotalRequestsLabelsMap } from '@diia-inhouse/diia-metrics'
import { ErrorType } from '@diia-inhouse/errors'
import { DurationMs, HttpMethod, HttpStatusCode, Logger } from '@diia-inhouse/types'

import {
    FullRequestOptions,
    HttpClientResponse,
    ObserveRequestBaseParams,
    ObserveRequestFailedParams,
    RequestHelperResponse,
    RequestOptions,
} from '../interfaces/httpClient'
import { OperationError, RequestError } from './errors'
import { waitAndRun } from './utils'

export class HttpClientService<TMetricLabel extends string> {
    constructor(
        private logger: Logger,
        private metrics: MetricsService,

        private readonly systemServiceName: string,
        private readonly timeout = DurationMs.Second * 30,
        private readonly baseUrl = '',
    ) {}

    async get<TResponse, TError>(path: string, opts: RequestOptions<TMetricLabel>): Promise<HttpClientResponse<TResponse, TError>> {
        return await this.request<TResponse, TError>({
            path,
            method: HttpMethod.GET,
            ...opts,
        })
    }

    async post<TResponse, TError>(path: string, opts: RequestOptions<TMetricLabel>): Promise<HttpClientResponse<TResponse, TError>> {
        return await this.request<TResponse, TError>({
            path,
            method: HttpMethod.POST,
            ...opts,
        })
    }

    async put<TResponse, TError>(path: string, opts: RequestOptions<TMetricLabel>): Promise<HttpClientResponse<TResponse, TError>> {
        return await this.request<TResponse, TError>({
            path,
            method: HttpMethod.PUT,
            ...opts,
        })
    }

    async delete<TResponse, TError>(path: string, opts: RequestOptions<TMetricLabel>): Promise<HttpClientResponse<TResponse, TError>> {
        return await this.request<TResponse, TError>({
            path,
            method: HttpMethod.DELETE,
            ...opts,
        })
    }

    async patch<TResponse, TError>(path: string, opts: RequestOptions<TMetricLabel>): Promise<HttpClientResponse<TResponse, TError>> {
        return await this.request<TResponse, TError>({
            path,
            method: HttpMethod.PATCH,
            ...opts,
        })
    }

    private async request<TResponse, TError>(opts: FullRequestOptions<TMetricLabel>): Promise<HttpClientResponse<TResponse, TError>> {
        const activeContext = context.active()
        const tracer = trace.getTracer(this.systemServiceName)

        const baseUrl = opts.baseUrl || this.baseUrl

        if (!baseUrl) {
            throw new Error('Base URL is not provided')
        }

        const span = tracer.startSpan(
            opts.method,
            {
                kind: SpanKind.CLIENT,
                attributes: {
                    [SEMATTRS_MESSAGING_SYSTEM]: RequestMechanism.Http,
                    [SemanticAttributes.HTTP_METHOD]: opts.method,
                    [SemanticAttributes.HTTP_URL]: `${baseUrl}${opts.path}`,
                    [SemanticAttributes.HTTP_TARGET]: opts.path,
                    'messaging.caller': this.systemServiceName,
                },
            },
            activeContext,
        )

        const { response, error, retryCount } = await this.requestHelper<TResponse>({ ...opts, baseUrl }, span)

        span?.setAttribute('retryCount', retryCount)

        if (response) {
            const statusCode = response.status

            this.logger.info('HTTP request succeeded', {
                statusCode,
                path: opts.path,
                method: opts.method,
            })

            span?.setStatus({ code: SpanStatusCode.OK })
            span?.setAttribute(SemanticAttributes.HTTP_STATUS_CODE, statusCode)
            span?.end()

            return {
                isOk: true,
                statusCode,
                headers: (response.headers as Record<string, string>) || {},
                body: response.data,
            }
        }

        if (error) {
            const { statusCode, originalError } = error

            this.logger.error('HTTP request failed', {
                err: error,
                method: opts.method,
                path: opts.path,
                statusCode,
            })

            span?.setStatus({ code: SpanStatusCode.ERROR })

            span?.recordException({
                name: originalError.name || 'Unexpected error',
                message: originalError.message,
                code: statusCode,
            })
            span?.end()

            return {
                isOk: false,
                statusCode,
                body: originalError instanceof AxiosError ? originalError.response?.data : undefined,
                headers: originalError instanceof AxiosError ? (originalError.response?.headers as Record<string, string>) || {} : {},
            }
        }

        throw new Error('Unexpected error caused')
    }

    private async requestHelper<TResponse>(
        opts: FullRequestOptions<TMetricLabel>,
        span: Span,
        currentRequestRetries = 0,
    ): Promise<RequestHelperResponse<TResponse>> {
        const timeout = opts.timeout || this.timeout

        const {
            method,
            path,
            baseUrl,
            query = {},
            body,
            headers = {},
            responseType = 'json',
            retries = 0,
            retryInterval = 0,
            httpsAgent,
            httpAgent,
            errorType: errorTypeOps,
            metricLabel,
        } = opts

        const startTime = process.hrtime.bigint()

        span.addEvent('request', { message: `Started processing request. Retry count ${currentRequestRetries}` })

        try {
            const response = await axios.request({
                method,
                baseURL: baseUrl,
                url: path,
                params: query,
                data: body,
                headers,
                responseType,
                timeout,
                httpsAgent,
                httpAgent,
            })

            this.observeSuccessRequest({
                statusCode: response.status,
                retryCount: currentRequestRetries,
                startTime,
                span,
                baseUrl: baseUrl!,
                metricLabel,
            })

            return { response, retryCount: currentRequestRetries }
        } catch (err) {
            const statusCode = (err as AxiosError)?.response?.status || HttpStatusCode.INTERNAL_SERVER_ERROR

            const errorType = ErrorType.External || errorTypeOps

            this.observeFailedRequest({
                statusCode,
                retryCount: currentRequestRetries,
                startTime,
                span,
                errorType,
                baseUrl: baseUrl!,
                metricLabel,
            })

            if (err instanceof AxiosError) {
                if (currentRequestRetries < retries) {
                    this.logger.info('Retrying HTTP request', {
                        err,
                        path,
                        retries: currentRequestRetries + 1,
                    })

                    return await waitAndRun(() => this.requestHelper<TResponse>(opts, span, currentRequestRetries + 1), retryInterval)
                }

                const requestError = new RequestError(err.message, statusCode, err)

                return { error: requestError, retryCount: currentRequestRetries }
            }

            const operationError = new OperationError('Internal package error', err as Error)

            return { error: operationError, retryCount: currentRequestRetries }
        }
    }

    private observeSuccessRequest(params: ObserveRequestBaseParams): void {
        const { statusCode, retryCount, startTime, span, baseUrl, metricLabel } = params

        const labels = this.getLabels(statusCode, RequestStatus.Successful, baseUrl, metricLabel)

        span.addEvent('request', { message: `Finished processing request. Retry count ${retryCount}` })

        this.metrics.totalTimerMetric.observeSeconds(labels, process.hrtime.bigint() - startTime)
    }

    private observeFailedRequest(params: ObserveRequestFailedParams): void {
        const { statusCode, retryCount, startTime, span, errorType, baseUrl, metricLabel } = params

        const labels = this.getLabels(statusCode, RequestStatus.Failed, baseUrl, metricLabel, errorType)

        span.addEvent('request', { message: `Finished processing request. Retry count ${retryCount}` })

        this.metrics.totalTimerMetric.observeSeconds(labels, process.hrtime.bigint() - startTime)
    }

    private getLabels(
        statusCode: number,
        status: RequestStatus,
        baseUrl: string,
        metricLabel: string,
        errorType?: ErrorType,
    ): TotalRequestsLabelsMap {
        return {
            status,
            statusCode,
            source: this.systemServiceName,
            destination: `${baseUrl}|${metricLabel}`,
            mechanism: RequestMechanism.Http,
            ...(errorType ? { errorType } : {}),
        }
    }
}
