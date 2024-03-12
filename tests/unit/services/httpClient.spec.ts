import { RequestOptions } from 'http'
import { Agent } from 'https'

import nock = require('nock')

import Logger from '@diia-inhouse/diia-logger'
import { mockClass } from '@diia-inhouse/test'
import { HttpMethod, HttpStatusCode } from '@diia-inhouse/types'

import { HttpClientService } from '../../../src'

const MockedLogger = mockClass(Logger)

describe(`HttpClientService service`, () => {
    describe('protocol: HTTP', () => {
        const loggerMock: Logger = new MockedLogger()
        const httpClientService = new HttpClientService(loggerMock)
        const mockResponse = { key: 'value' }
        let options: RequestOptions

        beforeEach(() => {
            options = { host: 'http://example.com' }
        })
        describe.each([
            [HttpMethod.GET, httpClientService.get.bind(httpClientService)],
            [HttpMethod.POST, httpClientService.post.bind(httpClientService)],
            [HttpMethod.PUT, httpClientService.put.bind(httpClientService)],
            [HttpMethod.DELETE, httpClientService.delete.bind(httpClientService)],
        ])('%s method retry logic', (httpMethod, serviceMethod) => {
            it('should make a request without retry when maxRetries is 0', async () => {
                let requestCounter = 0
                const mockOptions = { host: `${options.host}`, maxRetries: 0 }

                const mockedRequest = nock(`${mockOptions.host}`)
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
        })

        describe('method: `GET`', () => {
            test('should throw an error when an invalid host is provided', async () => {
                await expect(httpClientService.get({ host: 'invalid-host' })).rejects.toThrow('Host "invalid-host" must include protocol')
            })

            test('should throw an error when an unknown protocol is provided', async () => {
                const invalidOptions = { host: 'httpz://example.com' }

                await expect(async () => await httpClientService.get(invalidOptions)).rejects.toThrow('Unknown protocol, httpz')
            })

            it('should successfully return the response with string data', async () => {
                const mockedText = 'mockedText'

                const mockedRequest = nock(`${options.host}`).get('/').reply(HttpStatusCode.OK, mockedText)

                const [err, response] = await httpClientService.get(options)

                expect(err).toBeNull()
                expect(response).toMatchObject({
                    data: mockedText,
                    statusCode: HttpStatusCode.OK,
                })

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should successfully return the response with converted json data', async () => {
                const mockedObject = { property: 'test' }

                const mockedRequest = nock(`${options.host}`)
                    .get('/')
                    .reply(HttpStatusCode.OK, mockedObject, { 'Content-Type': 'application/json' })

                const [err, response] = await httpClientService.get(options)

                expect(err).toBeNull()
                expect(response).toMatchObject({
                    data: mockedObject,
                    statusCode: HttpStatusCode.OK,
                })

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should return binary data', async () => {
                const binaryData = Buffer.alloc(10, 1)

                const mockedRequest = nock(`${options.host}`)
                    .get('/')
                    .reply(HttpStatusCode.OK, binaryData, { 'Content-Type': 'application/pdf' })

                const [err, response] = await httpClientService.get(options)

                expect(err).toBeNull()
                expect(response).toMatchObject({
                    data: binaryData,
                    statusCode: HttpStatusCode.OK,
                })

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should throw an exception for broken JSON Data', async () => {
                const brokenData = JSON.stringify({ property: 'test' }).split('').splice(-3, 3).join('')

                const mockedRequest = nock(`${options.host}`)
                    .get('/')
                    .reply(HttpStatusCode.OK, brokenData, { 'Content-Type': 'application/json' })

                const [err] = await httpClientService.get(options)

                expect(err).toBeInstanceOf(Error)

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should return successful result for empty content-type', async () => {
                const responseData = ['t', 'e', 's', 't']

                const mockedRequest = nock(`${options.host}`).get('/').reply(HttpStatusCode.OK, responseData)

                const [err, response] = await httpClientService.get(options)

                expect(err).toBeNull()
                expect(response?.statusCode).toEqual(HttpStatusCode.OK)

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should return error with unsuccessful status code', async () => {
                const mockedRequest = nock(`${options.host}`)
                    .get('/')
                    .reply(HttpStatusCode.BAD_REQUEST, ['end'], { 'Content-Type': 'text/plain' })

                const [err] = await httpClientService.get(options)

                expect(err?.statusCode).toEqual(HttpStatusCode.BAD_REQUEST)

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should successfully return data of text/plain content-type', async () => {
                const mockedRequest = nock(`${options.host}`).get('/').reply(HttpStatusCode.OK, 'http', { 'Content-Type': 'text/plain' })

                const [err, response] = await httpClientService.get(options)

                expect(err).toBeNull()
                expect(response).toMatchObject({
                    data: 'http',
                    statusCode: HttpStatusCode.OK,
                })

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should return successful status code and empty data', async () => {
                const mockedRequest = nock(`${options.host}`).get('/').reply(HttpStatusCode.OK, '', { 'Content-Type': 'text/plain' })

                const [err, response] = await httpClientService.get(options)

                expect(err).toBeNull()
                expect(response).toMatchObject({
                    data: undefined,
                    statusCode: HttpStatusCode.OK,
                })

                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should throw an exception for a timeout', async () => {
                const localOptions = { ...options, timeout: 3 }
                const mockedRequest = nock(`${options.host}`)
                    .get('/')
                    .delay(5)
                    .reply(HttpStatusCode.BAD_REQUEST, ['end'], { 'Content-Type': 'text/plain' })

                const [err] = await httpClientService.get(localOptions)

                expect(err).toEqual(new Error('Failed due timeout reason'))
                expect(mockedRequest.isDone()).toBe(true)
            })

            it('should throw an exception for a abort', async () => {
                const localOptions = { ...options, timeout: 3 }
                const mockedRequest = nock(`${options.host}`)
                    .get('/')
                    .reply(function () {
                        this.req.emit('abort')
                    })

                const [err] = await httpClientService.get(localOptions)

                expect(err).toEqual(new Error('Failed due abort reason'))
                expect(mockedRequest.isDone()).toBe(true)
            })
        })

        describe('method: `POST`', () => {
            it('should return successful status code and valid data', async () => {
                const mockedData = { property: 'data' }
                const mockedRequest = nock(`${options.host}`)
                    .post('/')
                    .reply(HttpStatusCode.OK, mockedData, { 'Content-Type': 'application/json' })

                const [err, response] = await httpClientService.post(options, '', 'body')

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
                const mockedRequest = nock(`${options.host}`)
                    .delete('/')
                    .reply(HttpStatusCode.OK, mockedData, { 'Content-Type': 'application/json' })

                const [err, response] = await httpClientService.delete(options)

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
                const mockedRequest = nock(`${options.host}`)
                    .put('/')
                    .reply(HttpStatusCode.OK, mockedData, { 'Content-Type': 'application/json' })

                const [err, response] = await httpClientService.put(options)

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
        const loggerMock: Logger = new MockedLogger()
        const httpClientService = new HttpClientService(loggerMock)
        const mockResponse = { key: 'value' }
        const host = 'security-example.com'
        const options: RequestOptions = {
            host: `https://${host}}`,
        }
        const certFingerprint = 'fingerprint'

        it('should initiate options by agent', async () => {
            const nockMock = nock(`${options.host}`).intercept('/', 'get').reply(HttpStatusCode.OK, mockResponse)

            await httpClientService.get(options, certFingerprint)

            expect(nockMock.isDone()).toBeTruthy()

            expect(options.agent).toBeInstanceOf(Agent)
        })
    })
})
