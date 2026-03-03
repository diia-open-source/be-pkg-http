import { HttpStatusCode } from '@diia-inhouse/types'

import { RequestError } from './requestError'

export class OperationError extends RequestError {
    constructor(message: string, originalError: Error) {
        super(message, HttpStatusCode.INTERNAL_SERVER_ERROR, originalError)

        this.name = 'OperationError'
    }
}
