import { HttpStatusCode } from '@diia-inhouse/types'

import { RequestError } from './requestError.js'

export class OperationError extends RequestError {
    constructor(message: string, originalError: Error) {
        super(message, HttpStatusCode.INTERNAL_SERVER_ERROR, originalError)

        this.name = 'OperationError'
    }
}
