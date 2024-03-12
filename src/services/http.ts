import { ClientRequest, IncomingHttpHeaders, IncomingMessage, request as httpRequest } from 'http'
import { Agent, request as httpsRequest } from 'https'
import { ParsedUrlQueryInput, stringify } from 'querystring'
import * as tsl from 'tls'

import to from 'await-to-js'
import { cloneDeep } from 'lodash'

import { RequestTimeoutError, ServiceUnavailableError } from '@diia-inhouse/errors'
import { HttpMethod, HttpProtocol, Logger, PeerCertificateWithSHA256 } from '@diia-inhouse/types'

import { ExtendedRequestOptions, HttpServiceResponse, HttpServiceResponseResult } from '../interfaces'

/**
 * @deprecated use HttpClientService
 */
export class HttpService {
    // eslint-disable-next-line @typescript-eslint/ban-types
    private requestFn: Function

    private readonly binaryMimeTypes: string[] = ['application/pdf', 'application/p7s']

    private readonly binaryMimeTypesPrefixes: string[] = ['image/']

    constructor(
        private readonly logger: Logger,
        protocol: HttpProtocol,
    ) {
        this.requestFn = protocol === HttpProtocol.Http ? httpRequest : httpsRequest
    }

    async get(options: ExtendedRequestOptions, hostFingerprint?: string): Promise<HttpServiceResponse> {
        this.setMethod(options, HttpMethod.GET)
        this.setCheckServerIdentity(options, hostFingerprint)

        return await to<HttpServiceResponseResult>(this.makeRequest(options))
    }

    async post(
        options: ExtendedRequestOptions,
        hostFingerprint?: string,
        body?: string | ParsedUrlQueryInput,
    ): Promise<HttpServiceResponse> {
        this.setMethod(options, HttpMethod.POST)
        this.setCheckServerIdentity(options, hostFingerprint)

        return await to<HttpServiceResponseResult>(this.makeRequest(options, body))
    }

    async delete(
        options: ExtendedRequestOptions,
        hostFingerprint?: string,
        body?: string | ParsedUrlQueryInput,
    ): Promise<HttpServiceResponse> {
        this.setMethod(options, HttpMethod.DELETE)
        this.setCheckServerIdentity(options, hostFingerprint)

        return await to<HttpServiceResponseResult>(this.makeRequest(options, body))
    }

    async put(
        options: ExtendedRequestOptions,
        hostFingerprint?: string,
        body?: string | ParsedUrlQueryInput,
    ): Promise<HttpServiceResponse> {
        this.setMethod(options, HttpMethod.PUT)
        this.setCheckServerIdentity(options, hostFingerprint)

        return await to<HttpServiceResponseResult>(this.makeRequest(options, body))
    }

    private setMethod(options: ExtendedRequestOptions, method: HttpMethod): void {
        options.method = method
    }

    private setCheckServerIdentity(options: ExtendedRequestOptions, hostFingerprint?: string): void {
        if (!hostFingerprint) {
            return
        }

        const checkServerIdentity: typeof tsl.checkServerIdentity = (host: string, cert: PeerCertificateWithSHA256): Error | undefined => {
            const certFingerprint: string = cert.fingerprint256 || cert.fingerprint

            this.logger.info(`Checking fingerprint for host: ${host}, fingerprint is ${certFingerprint}`)
            if (!hostFingerprint || hostFingerprint === certFingerprint) {
                this.logger.info('Fingerprint validated successfully')

                return
            }

            this.logger.info('Failed to validate fingerprint')

            return new Error(`Fingerprint for host ${host} does not match`)
        }

        if (options.agent instanceof Agent) {
            ;(<Agent>options.agent).options.checkServerIdentity = checkServerIdentity
        } else {
            options.agent = new Agent({ checkServerIdentity })
        }
    }

    private makeRequest(
        options: ExtendedRequestOptions,
        body?: string | ParsedUrlQueryInput,
    ): Promise<IncomingMessage & { data?: unknown }> {
        const { maxRetries = 0, retryDelay = 0, ...requestOptions } = options

        return new Promise(
            (
                resolve: (res: IncomingMessage & { data?: unknown }) => void,
                reject: (res: (IncomingMessage & { data?: unknown }) | Error) => void,
            ) => {
                let retries = 0

                const performRequest = (): void => {
                    try {
                        const data: (string | Buffer)[] = []
                        const request: ClientRequest = this.requestFn(requestOptions, (response: IncomingMessage) => {
                            if (!this.isBinaryContentType(response.headers)) {
                                response.setEncoding('utf8')
                            }

                            response.on('data', (chunk: string | Buffer) => {
                                data.push(chunk)
                            })

                            response.on('end', () => {
                                let parsedData: unknown
                                const res: IncomingMessage & { data?: unknown } = cloneDeep(response)
                                const { statusCode = '' } = res
                                const isSuccessStatusCode: boolean = /2\d{2}/.test(statusCode.toString())

                                res.data = res.data || undefined

                                if (!data.length) {
                                    this.logger.info('No data in response', { statusCode })

                                    if (!isSuccessStatusCode) {
                                        if (retries < maxRetries) {
                                            retries++

                                            return setTimeout(performRequest, retryDelay)
                                        } else {
                                            return reject(res)
                                        }
                                    }

                                    return resolve(res)
                                }

                                try {
                                    if (this.isJsonContentType(response.headers)) {
                                        parsedData = JSON.parse(data.join(''))
                                        res.data = parsedData
                                    } else if (this.isBinaryContentType(response.headers)) {
                                        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                                        res.data = Buffer.concat(data as unknown as Buffer[])
                                    } else {
                                        res.data = data.join('')
                                    }
                                } catch (err) {
                                    this.logger.error(`Failed to parse data: ${data}`)

                                    if (err instanceof Error) {
                                        return reject(err)
                                    }
                                }

                                if (!isSuccessStatusCode) {
                                    if (retries < maxRetries) {
                                        retries++

                                        return setTimeout(performRequest, retryDelay)
                                    } else {
                                        return reject(res)
                                    }
                                }

                                return resolve(res)
                            })
                        })

                        request.on('error', (err: Error) => {
                            if (retries < maxRetries) {
                                retries++
                                setTimeout(performRequest, retryDelay)
                            } else {
                                reject(err)
                            }
                        })

                        request.on('timeout', () => {
                            const message = 'Failed due timeout reason'

                            this.logger.error(message)
                            if (retries < maxRetries) {
                                retries++
                                setTimeout(performRequest, retryDelay)
                            } else {
                                reject(new RequestTimeoutError(message))
                            }
                        })

                        request.on('abort', () => {
                            const message = 'Failed due abort reason'

                            this.logger.error(message)
                            if (retries < maxRetries) {
                                retries++
                                setTimeout(performRequest, retryDelay)
                            } else {
                                reject(new ServiceUnavailableError(message))
                            }
                        })

                        if (body) {
                            const preparedBody: string = typeof body === 'string' ? body : stringify(body)

                            request.write(preparedBody)
                        }

                        request.end()
                    } catch (err) {
                        if (err instanceof Error) {
                            return reject(err)
                        }
                    }
                }

                performRequest()
            },
        )
    }

    private isJsonContentType(headers: IncomingHttpHeaders): boolean {
        const contentTypeHeader = headers['content-type']

        if (!contentTypeHeader) {
            return false
        }

        return /^application\/json/.test(contentTypeHeader)
    }

    private isBinaryContentType(headers: IncomingHttpHeaders): boolean {
        const contentTypeHeader = headers['content-type']

        if (!contentTypeHeader) {
            return false
        }

        return (
            this.binaryMimeTypes.includes(contentTypeHeader) ||
            this.binaryMimeTypesPrefixes.some((mimeTypePrefix) => contentTypeHeader.startsWith(mimeTypePrefix))
        )
    }
}
