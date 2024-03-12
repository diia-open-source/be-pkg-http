/* eslint-disable @typescript-eslint/no-explicit-any */
import { IncomingMessage } from 'http'
import { RequestOptions } from 'https'

import { HttpStatusCode } from '@diia-inhouse/types'

export interface HttpServiceResponseResult<T = any> {
    data?: T
    headers?: IncomingMessage['headers']
    statusCode?: HttpStatusCode
    statusMessage?: string
}

export type HttpServiceResponse<T = any> = [Error & HttpServiceResponseResult<T>, undefined] | [null, HttpServiceResponseResult]

export interface ExtendedRequestOptions extends RequestOptions {
    maxRetries?: number
    retryDelay?: number
}
