export class RequestError extends Error {
    readonly statusCode: number

    readonly originalError: Error

    constructor(message: string, statusCode: number, originalError: Error) {
        super(message)

        this.name = 'RequestError'
        this.statusCode = statusCode
        this.originalError = originalError
    }
}
