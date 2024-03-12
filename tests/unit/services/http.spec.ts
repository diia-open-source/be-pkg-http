import { Agent, RequestOptions } from 'http'

import nock = require('nock')

import Logger from '@diia-inhouse/diia-logger'
import { RequestTimeoutError, ServiceUnavailableError } from '@diia-inhouse/errors'
import { mockClass } from '@diia-inhouse/test'
import { HttpMethod, HttpProtocol, HttpStatusCode } from '@diia-inhouse/types'

import { HttpService } from '../../../src'

const MockedLogger = mockClass(Logger)

describe('HttpService service', () => {
    const loggerMock: Logger = new MockedLogger()

    describe('protocol: HTTP', () => {
        const httpService = new HttpService(loggerMock, HttpProtocol.Http)
        const mockResponse = { key: 'value' }

        const options: RequestOptions = {
            hostname: 'example.com',
            port: 80,
            path: '/',
            method: 'GET',
            agent: undefined,
        }

        describe.each([
            [HttpMethod.GET, httpService.get.bind(httpService)],
            [HttpMethod.POST, httpService.post.bind(httpService)],
            [HttpMethod.PUT, httpService.put.bind(httpService)],
            [HttpMethod.DELETE, httpService.delete.bind(httpService)],
        ])('%s method retry logic', (httpMethod, serviceMethod) => {
            it('should make a request without retry when maxRetries is 0', async () => {
                let requestCounter = 0
                const mockOptions = { host: 'localhost', method: httpMethod, maxRetries: 0 }

                const mockedRequest = nock(`http://${mockOptions.host}`)
                    .intercept('/', httpMethod)
                    .reply(HttpStatusCode.OK, mockResponse)
                    .on('request', () => {
                        requestCounter++
                    })

                const [err, response] = await serviceMethod(mockOptions)

                expect(err).toBeNull()
                expect(response).toMatchObject({
                    data: mockResponse,
                    statusCode: HttpStatusCode.OK,
                })
                expect(requestCounter).toBe(1)
                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should retry on failure when maxRetries > 0', async () => {
                const mockOptions = { host: 'localhost', method: httpMethod, retryDelay: 1, maxRetries: 1 }

                const mockedRequest = nock(`http://${mockOptions.host}`)
                    .intercept('/', httpMethod)
                    .reply(HttpStatusCode.INTERNAL_SERVER_ERROR, 'Server Error')
                    .intercept('/', httpMethod)
                    .reply(HttpStatusCode.OK, mockResponse)

                const [err, response] = await serviceMethod(mockOptions)

                expect(err).toBeNull()
                expect(response).toMatchObject({
                    data: mockResponse,
                    statusCode: HttpStatusCode.OK,
                })

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should respect retryDelay', async () => {
                const mockOptions = { host: 'localhost', method: httpMethod, retryDelay: 50, maxRetries: 1 }
                let firstRequestTime = 0
                let secondRequestTime = 0

                const mockedRequest = nock(`http://${mockOptions.host}`)
                    .intercept('/', httpMethod)
                    .reply(function () {
                        firstRequestTime = Date.now()

                        return [HttpStatusCode.INTERNAL_SERVER_ERROR, 'Server Error']
                    })
                    .intercept('/', httpMethod)
                    .reply(function () {
                        secondRequestTime = Date.now()

                        return [HttpStatusCode.OK, mockResponse]
                    })

                const [err, response] = await serviceMethod(mockOptions)

                expect(err).toBeNull()
                expect(response).toMatchObject({
                    data: mockResponse,
                    statusCode: HttpStatusCode.OK,
                })
                expect(secondRequestTime - firstRequestTime).toBeGreaterThanOrEqual(mockOptions.retryDelay)

                expect(mockedRequest.isDone()).toBe(true)
            })
        })

        describe('method: `GET`', () => {
            it('should successfully return the response with converted json data', async () => {
                const mockedRequest = nock(`http://${options.hostname}`)
                    .get('/')
                    .reply(HttpStatusCode.OK, mockResponse, { 'Content-Type': 'application/json' })

                const [err, response] = await httpService.get(options)

                expect(err).toBeNull()
                expect(response).toMatchObject({
                    data: mockResponse,
                    statusCode: HttpStatusCode.OK,
                })

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should return binary data', async () => {
                const binaryData = Buffer.alloc(10, 1)

                const mockedRequest = nock(`http://${options.hostname}`)
                    .get('/')
                    .reply(HttpStatusCode.OK, binaryData, { 'Content-Type': 'application/pdf' })

                const [err, response] = await httpService.get(options)

                expect(err).toBeNull()
                expect(response).toMatchObject({
                    data: binaryData,
                    statusCode: HttpStatusCode.OK,
                })

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should throw an exception for broken JSON Data', async () => {
                const brokenData = JSON.stringify({ property: 'test' }).split('').splice(-3, 3).join('')

                const mockedRequest = nock(`http://${options.hostname}`)
                    .get('/')
                    .reply(HttpStatusCode.OK, brokenData, { 'Content-Type': 'application/json' })

                const [err] = await httpService.get(options)

                expect(err).toBeInstanceOf(Error)

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should return successful result for empty content-type', async () => {
                const responseData = ['t', 'e', 's', 't']

                const mockedRequest = nock(`http://${options.hostname}`).get('/').reply(HttpStatusCode.OK, responseData)

                const [err, response] = await httpService.get(options)

                expect(err).toBeNull()
                expect(response?.statusCode).toEqual(HttpStatusCode.OK)

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should successfully return data of text/plain content-type', async () => {
                const mockedRequest = nock(`http://${options.hostname}`)
                    .get('/')
                    .reply(HttpStatusCode.OK, 'http', { 'Content-Type': 'text/plain' })

                const [err, response] = await httpService.get(options)

                expect(err).toBeNull()
                expect(response).toMatchObject({
                    data: 'http',
                    statusCode: HttpStatusCode.OK,
                })

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should return successful status code and empty data', async () => {
                const mockedRequest = nock(`http://${options.hostname}`)
                    .get('/')
                    .reply(HttpStatusCode.OK, '', { 'Content-Type': 'text/plain' })

                const [err, response] = await httpService.get(options)

                expect(err).toBeNull()

                expect(response).toMatchObject({
                    data: undefined,
                    statusCode: HttpStatusCode.OK,
                })

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should throw an exception for unsuccessful status code', async () => {
                const mockedRequest = nock(`http://${options.hostname}`)
                    .get('/')
                    .reply(HttpStatusCode.BAD_REQUEST, ['end'], { 'Content-Type': 'text/plain' })

                const [err] = await httpService.get(options)

                expect(err?.statusCode).toEqual(HttpStatusCode.BAD_REQUEST)

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should throw an exception for a timeout', async () => {
                const localOptions = { ...options, timeout: 3 }
                const mockedRequest = nock(`http://${options.hostname}`)
                    .get('/')
                    .delay(5)
                    .reply(HttpStatusCode.BAD_REQUEST, ['end'], { 'Content-Type': 'text/plain' })

                const [err] = await httpService.get(localOptions)

                expect(err).toEqual(new Error('Failed due timeout reason'))
                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should not set checkServerIdentity when hostFingerprint is not provided', async () => {
                const mockedRequest = nock(`http://${options.hostname}`)

                await httpService.get(options)

                expect(options.agent).toBeUndefined()

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should set checkServerIdentity when hostFingerprint is provided', async () => {
                const mockedRequest = nock(`http://${options.hostname}`)
                const fingerprint = 'fingerprint'

                await httpService.get(options, fingerprint)

                expect(options.agent).toBeInstanceOf(Agent)

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should resolve with successful status code after retries', async () => {
                const localOptions = { ...options, maxRetries: 4 }

                const mockedRequest = nock(`http://${options.hostname}`)
                    .get('/')
                    .times(3)
                    .reply(HttpStatusCode.SERVICE_UNAVAILABLE, '')
                    .get('/')
                    .reply(HttpStatusCode.OK, '')

                const [err, response] = await httpService.get(localOptions)

                expect(err).toBeNull()
                expect(response).toMatchObject({
                    data: undefined,
                    statusCode: HttpStatusCode.OK,
                })

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should reject after max retries', async () => {
                let requestCounter = 0
                const localOptions = { ...options, maxRetries: 5 }

                const mockedRequest = nock(`http://${options.hostname}`)
                    .get('/')
                    .times(5)
                    .reply(HttpStatusCode.SERVICE_UNAVAILABLE, 'Service Unavailable')
                    .on('request', () => {
                        requestCounter++
                    })

                const [err] = await httpService.get(localOptions)

                expect(err?.statusCode).toEqual(HttpStatusCode.NOT_FOUND)
                expect(requestCounter).toBe(5)

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should reject after timeout', async () => {
                const localOptions = { ...options, timeout: 3 }

                const mockedRequest = nock(`http://${options.hostname}`).get('/').delayConnection(5).reply(HttpStatusCode.OK, 'response 1')

                const [err] = await httpService.get(localOptions)

                expect(err).toBeInstanceOf(RequestTimeoutError)
                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should reject after about', async () => {
                const localOptions = { ...options, timeout: 3 }

                const mockedRequest = nock(`http://${options.hostname}`)
                    .get('/')
                    .delayConnection(5)
                    .reply(function () {
                        this.req.emit('abort')
                    })

                const [err] = await httpService.get(localOptions)

                expect(err).toEqual(new ServiceUnavailableError('Failed due abort reason'))
                expect(mockedRequest.isDone()).toBe(true)
            })
        })

        describe('method: `POST`', () => {
            it('should return successful status code and valid data', async () => {
                const mockedData = { property: 'data' }
                const mockedRequest = nock(`http://${options.hostname}`)
                    .post('/')
                    .reply(HttpStatusCode.OK, mockedData, { 'Content-Type': 'application/json' })

                const [err, response] = await httpService.post(options, '', 'body')

                expect(err).toBeNull()
                expect(response).toMatchObject({
                    req: expect.objectContaining({
                        method: HttpMethod.POST,
                    }),
                    data: mockedData,
                    statusCode: HttpStatusCode.OK,
                })

                expect(mockedRequest.isDone()).toBe(true)
            })
        })

        describe('method: `DELETE`', () => {
            it('should return successful status code and valid data', async () => {
                const mockedData = { property: 'data' }
                const mockedRequest = nock(`http://${options.hostname}`)
                    .delete('/')
                    .reply(HttpStatusCode.OK, mockedData, { 'Content-Type': 'application/json' })

                const [err, response] = await httpService.delete(options)

                expect(err).toBeNull()
                expect(response).toMatchObject({
                    req: expect.objectContaining({
                        method: HttpMethod.DELETE,
                    }),
                    data: mockedData,
                    statusCode: HttpStatusCode.OK,
                })

                expect(mockedRequest.isDone()).toBe(true)
            })
        })

        describe('method: `PUT`', () => {
            it('should return successful status code and valid data', async () => {
                const mockedData = { property: 'data' }
                const mockedRequest = nock(`http://${options.hostname}`)
                    .put('/')
                    .reply(HttpStatusCode.OK, mockedData, { 'Content-Type': 'application/json' })

                const [err, response] = await httpService.put(options)

                expect(err).toBeNull()
                expect(response).toMatchObject({
                    req: expect.objectContaining({
                        method: HttpMethod.PUT,
                    }),
                    data: mockedData,
                    statusCode: HttpStatusCode.OK,
                })

                expect(mockedRequest.isDone()).toBe(true)
            })
        })
    })

    describe('protocol: HTTPS', () => {
        const httpsService = new HttpService(loggerMock, HttpProtocol.Https)
        const host = 'security-example.com'
        const options: RequestOptions = {
            host,
        }
        const certFingerprint = 'fingerprint'

        it('should initiate options by agent', async () => {
            const mockedRequest = nock(`https://${options.host}`).get('/').reply(HttpStatusCode.OK, 'test')

            await httpsService.get(options, certFingerprint)

            expect(mockedRequest.isDone()).toBeTruthy()
            expect(options.agent).toBeInstanceOf(Agent)
        })
    })
})
