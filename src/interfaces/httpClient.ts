import { Agent as httpAgent } from 'node:http'
import { Agent as httpsAgent } from 'node:https'

import { Span } from '@opentelemetry/api'
import { AxiosResponse, ResponseType } from 'axios'

import { ErrorType } from '@diia-inhouse/errors'
import { HttpMethod, HttpStatusCode } from '@diia-inhouse/types'

import { OperationError, RequestError } from '../services/errors'

export type ReadonlyQuery = Readonly<object>

/**
 * Enforces that T is a string literal or union of literals, not the broad `string` type.
 * Resolves to `never` if T is exactly `string`, causing a compile error.
 */
type LowCardinality<T extends string> = string extends T ? never : T

export interface RequestOptions<TMetricLabel extends string> {
    baseUrl?: string
    timeout?: number
    retries?: number
    retryInterval?: number
    query?: ReadonlyQuery
    headers?: Record<string, string>
    body?: unknown
    errorType?: ErrorType
    responseType?: ResponseType
    httpsAgent?: httpsAgent
    httpAgent?: httpAgent
    /**
     * Label used to separate metrics on the same destination host.
     *
     * **Must have low cardinality** — use a finite set of known values, not dynamic strings
     * like URLs, IDs, or user input. High-cardinality labels cause metric explosion and
     * degrade monitoring system performance.
     *
     * Define as a string union type to enforce allowed values at compile time:
     * @example
     * type MyMetricLabel = 'getUserProfile' | 'createOrder' | 'validateDocument'
     * const options: RequestOptions<MyMetricLabel> = { metricLabel: 'getUserProfile', ... }
     */
    metricLabel: LowCardinality<TMetricLabel>
}

export interface FullRequestOptions<TMetricLabel extends string> extends RequestOptions<TMetricLabel> {
    path: string
    method: HttpMethod
}

export interface SuccessfulResponse<T> {
    isOk: true
    statusCode: HttpStatusCode
    headers?: Record<string, string>
    body: T
}

export interface FailureResponse<TError> {
    isOk: false
    statusCode: HttpStatusCode
    headers?: Record<string, string>
    body: TError | undefined
}

export type HttpClientResponse<TResponse, TError = unknown> = SuccessfulResponse<TResponse> | FailureResponse<TError>

export interface ObserveRequestBaseParams {
    statusCode: number
    retryCount: number
    startTime: bigint
    span: Span
    baseUrl: string
    metricLabel: string
}

export interface ObserveRequestFailedParams extends ObserveRequestBaseParams {
    errorType: ErrorType
}

export interface RequestHelperResponse<TResponse> {
    response?: AxiosResponse<TResponse>
    error?: RequestError | OperationError
    retryCount: number
}
