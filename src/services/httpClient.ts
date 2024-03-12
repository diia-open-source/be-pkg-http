import { ClientRequest, IncomingHttpHeaders, IncomingMessage, request as httpRequest } from 'http'
import { Agent, RequestOptions, request as httpsRequest } from 'https'
import { ParsedUrlQueryInput, stringify } from 'querystring'
import * as tsl from 'tls'

import to from 'await-to-js'
import { cloneDeep } from 'lodash'

import { RequestTimeoutError, ServiceUnavailableError } from '@diia-inhouse/errors'
import { HttpMethod, Logger, PeerCertificateWithSHA256 } from '@diia-inhouse/types'

import { HttpServiceResponse, HttpServiceResponseResult } from '../interfaces'

export class HttpClientService {
    private readonly binaryMimeTypes: string[] = ['application/pdf', 'application/p7s']

    private readonly binaryMimeTypesPrefixes: string[] = ['image/']

    constructor(private logger: Logger) {}

    async get<T>(options: RequestOptions, hostFingerprint?: string): Promise<HttpServiceResponse<T>> {
        this.setCheckServerIdentity(options, hostFingerprint)

        return await to<HttpServiceResponseResult>(this.makeRequest(HttpMethod.GET, options))
    }

    async post<T>(options: RequestOptions, hostFingerprint?: string, body?: unknown): Promise<HttpServiceResponse<T>> {
        this.setCheckServerIdentity(options, hostFingerprint)

        return await to<HttpServiceResponseResult>(this.makeRequest(HttpMethod.POST, options, body))
    }

    async put<T>(options: RequestOptions, hostFingerprint?: string, body?: unknown): Promise<HttpServiceResponse<T>> {
        this.setCheckServerIdentity(options, hostFingerprint)

        return await to<HttpServiceResponseResult>(this.makeRequest(HttpMethod.PUT, options, body))
    }

    async delete<T>(options: RequestOptions, hostFingerprint?: string, body?: unknown): Promise<HttpServiceResponse<T>> {
        this.setCheckServerIdentity(options, hostFingerprint)

        return await to<HttpServiceResponseResult>(this.makeRequest(HttpMethod.DELETE, options, body))
    }

    private makeRequest(method: HttpMethod, options: RequestOptions, body?: unknown): Promise<IncomingMessage & { data?: unknown }> {
        options.method = method

        let parsedHost: URL
        try {
            parsedHost = new URL(options?.host || '')
        } catch (err) {
            const msg = `Host "${options.host}" must include protocol`

            this.logger.error(msg, { err })

            throw new Error(msg)
        }

        options.host = parsedHost.hostname
        options.port = parsedHost.port || options.port

        let requestFn: typeof httpRequest
        if (parsedHost.protocol === 'https:') {
            requestFn = httpsRequest
        } else if (parsedHost.protocol === 'http:') {
            requestFn = httpRequest
        } else {
            throw new Error(`Unknown protocol, ${parsedHost.protocol}`)
        }

        return new Promise(
            (
                resolve: (res: IncomingMessage & { data?: unknown }) => void,
                reject: (res: (IncomingMessage & { data?: unknown }) | Error) => void,
            ) => {
                try {
                    const data: (string | Buffer)[] = []

                    const request: ClientRequest = requestFn(options, (response: IncomingMessage) => {
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

                                return isSuccessStatusCode ? resolve(res) : reject(res)
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
                                return reject(res)
                            }

                            return resolve(res)
                        })
                    })

                    request.on('error', (err: Error) => reject(err))

                    request.on('timeout', () => {
                        const msg = 'Failed due timeout reason'

                        this.logger.error(msg)

                        return reject(new RequestTimeoutError(msg))
                    })

                    request.on('abort', () => {
                        const msg = 'Failed due abort reason'

                        this.logger.error(msg)

                        return reject(new ServiceUnavailableError(msg))
                    })

                    if (body) {
                        const preparedBody: string = typeof body === 'string' ? body : stringify(<ParsedUrlQueryInput>body)

                        request.write(preparedBody)
                    }

                    request.end()
                } catch (err) {
                    if (err instanceof Error) {
                        return reject(err)
                    }
                }
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

    private setCheckServerIdentity(options: RequestOptions, hostFingerprint?: string): void {
        if (!hostFingerprint) {
            return
        }

        const checkServerIdentity: typeof tsl.checkServerIdentity = (host: string, cert: PeerCertificateWithSHA256): Error | undefined => {
            const certFingerprint: string = cert.fingerprint256 || cert.fingerprint

            this.logger.info(`Checking fingerprint for host: ${host}, fingerprint is ${certFingerprint}`)
            if (hostFingerprint === certFingerprint) {
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
}
