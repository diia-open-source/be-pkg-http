import { Agent } from 'node:https'

import nock from 'nock'
import { assertType, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { mock } from 'vitest-mock-extended'

import Logger from '@diia-inhouse/diia-logger'
import { MetricsService } from '@diia-inhouse/diia-metrics'
import { HttpMethod, HttpStatusCode } from '@diia-inhouse/types'

import { HttpClientService, RequestOptions, checkServerIdentity } from '../../../src'

const MockedLogger = mock(Logger)

type TestMetricLabels = 'testRequest' | 'getUser' | 'createUser' | 'deleteUser'

describe('HttpClientService', () => {
    const loggerMock = new MockedLogger()
    const metricsMock = new MetricsService(
        loggerMock,
        {
            pushGateway: {
                isEnabled: true,
                url: 'http://localhost:9091',
            },
        },
        'service-name',
    )
    const baseUrl = 'http://example.com'
    const httpClientService = new HttpClientService<TestMetricLabels>(loggerMock, metricsMock, 'service-name', undefined, baseUrl)

    beforeEach(() => {
        nock.cleanAll()
    })

    describe.each<[HttpMethod, keyof HttpClientService<TestMetricLabels>]>([
        [HttpMethod.GET, 'get'],
        [HttpMethod.POST, 'post'],
        [HttpMethod.PUT, 'put'],
        [HttpMethod.DELETE, 'delete'],
        [HttpMethod.PATCH, 'patch'],
    ])('%s method', (method, methodName) => {
        it(`should successfully make a ${method} request`, async () => {
            const path = '/test'
            const mockResponse = { data: 'test-response' }

            const mockedRequest = nock(baseUrl).intercept(path, method).reply(200, mockResponse, { 'content-type': 'application/json' })

            const response = await httpClientService[methodName](path, { metricLabel: 'testRequest' })

            expect(response).toMatchObject({
                isOk: true,
                statusCode: HttpStatusCode.OK,
                headers: { 'content-type': 'application/json' },
                body: mockResponse,
            })

            expect(mockedRequest.isDone()).toBe(true)
        })

        it(`should handle ${method} request failure`, async () => {
            const path = '/test'
            const errorResponse = { message: 'Bad Request' }

            const mockedRequest = nock(baseUrl)
                .intercept(path, method)
                .reply(HttpStatusCode.BAD_REQUEST, errorResponse, { 'content-type': 'application/json' })

            const response = await httpClientService[methodName](path, { metricLabel: 'testRequest' })

            expect(response).toMatchObject({
                isOk: false,
                statusCode: HttpStatusCode.BAD_REQUEST,
                headers: { 'content-type': 'application/json' },
                body: errorResponse,
            })

            expect(mockedRequest.isDone()).toBe(true)
        })

        it(`should handle ${method} request timeout`, async () => {
            const path = '/test'
            const timeout = 1000 // 1 second

            const mockedRequest = nock(baseUrl)
                .intercept(path, method)
                .delayConnection(timeout * 2)
                .reply(200, { data: 'should not receive this' })

            const response = await httpClientService[methodName](path, { metricLabel: 'testRequest', timeout })

            expect(response).toMatchObject({
                isOk: false,
                statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
                headers: {},
                body: undefined,
            })

            expect(mockedRequest.isDone()).toBe(true)
        })
    })

    describe('get method with query parameters', () => {
        it('should properly stringify query parameters', async () => {
            const path = '/test'
            const queryParams = {
                param1: 'value1',
                param2: 123,
                param3: true,
            }
            const mockResponse = { data: 'test-response' }

            const mockedRequest = nock(baseUrl).get(path).query(queryParams).reply(200, mockResponse)

            const response = await httpClientService.get(path, { metricLabel: 'testRequest', query: queryParams })

            expect(response).toMatchObject({
                isOk: true,
                statusCode: HttpStatusCode.OK,
                body: mockResponse,
            })

            expect(mockedRequest.isDone()).toBe(true)
        })
    })

    describe('patch method with body', () => {
        it('should properly send patch request with body', async () => {
            const path = '/test'
            const requestBody = {
                field1: 'value1',
                field2: 123,
                field3: true,
            }
            const mockResponse = { data: 'test-response' }

            const mockedRequest = nock(baseUrl).patch(path, requestBody).reply(200, mockResponse)

            const response = await httpClientService.patch(path, { metricLabel: 'testRequest', body: requestBody })

            expect(response).toMatchObject({
                isOk: true,
                statusCode: HttpStatusCode.OK,
                body: mockResponse,
            })

            expect(mockedRequest.isDone()).toBe(true)
        })
    })

    describe('retry mechanism', () => {
        it('should retry failed requests with delay', async () => {
            const path = '/test'
            const mockResponse = { data: 'test-response' }
            const retryCount = 2
            const retryDelay = 100

            const mockedRequest = nock(baseUrl)
                .get(path)
                .reply(HttpStatusCode.SERVICE_UNAVAILABLE)
                .get(path)
                .reply(HttpStatusCode.SERVICE_UNAVAILABLE)
                .get(path)
                .reply(HttpStatusCode.OK, mockResponse)

            const startTime = Date.now()
            const response = await httpClientService.get(path, {
                metricLabel: 'testRequest',
                retries: retryCount,
                retryInterval: retryDelay,
            })
            const endTime = Date.now()

            expect(response).toMatchObject({
                isOk: true,
                statusCode: HttpStatusCode.OK,
                body: mockResponse,
            })

            expect(mockedRequest.isDone()).toBe(true)
            expect(endTime - startTime).toBeGreaterThanOrEqual(retryDelay * retryCount)
        })
    })

    describe('baseUrl in method params', () => {
        it('should override default baseUrl when provided in method params', async () => {
            const path = '/test'
            const overrideBaseUrl = 'http://override-example.com'
            const mockResponse = { data: 'test-response' }

            const mockedRequest = nock(overrideBaseUrl).get(path).reply(HttpStatusCode.OK, mockResponse)

            const response = await httpClientService.get(path, { metricLabel: 'testRequest', baseUrl: overrideBaseUrl })

            expect(response).toMatchObject({
                isOk: true,
                statusCode: HttpStatusCode.OK,
                body: mockResponse,
            })

            expect(mockedRequest.isDone()).toBe(true)
        })
    })

    describe('custom https agent', () => {
        it('should use provided https agent in request', async () => {
            const path = '/test'
            const mockResponse = { data: 'test-response' }
            const customAgent = new Agent({ rejectUnauthorized: false })

            const mockedRequest = nock(baseUrl).get(path).reply(HttpStatusCode.OK, mockResponse)

            const response = await httpClientService.get(path, { metricLabel: 'testRequest', httpsAgent: customAgent })

            expect(response).toMatchObject({
                isOk: true,
                statusCode: HttpStatusCode.OK,
                body: mockResponse,
            })

            expect(mockedRequest.isDone()).toBe(true)
        })

        it('should use provided checkServerIdentity function', async () => {
            const path = '/test'
            const mockResponse = { data: 'test-response' }

            const mockedRequest = nock(baseUrl).get(path).reply(HttpStatusCode.OK, mockResponse)

            const customAgent = new Agent({ checkServerIdentity: checkServerIdentity('host-fingerprint') })

            const response = await httpClientService.get(path, {
                metricLabel: 'testRequest',
                httpsAgent: customAgent,
            })

            expect(response).toMatchObject({
                isOk: true,
                statusCode: HttpStatusCode.OK,
                body: mockResponse,
            })

            expect(mockedRequest.isDone()).toBe(true)
        })
    })

    describe('metricLabel', () => {
        it('should include metricLabel in metric destination', async () => {
            const path = '/users/123'
            const mockResponse = { id: '123', name: 'Test User' }

            const observeSecondsSpy = vi.spyOn(metricsMock.totalTimerMetric, 'observeSeconds')

            const mockedRequest = nock(baseUrl).get(path).reply(HttpStatusCode.OK, mockResponse)

            const response = await httpClientService.get(path, { metricLabel: 'getUser' })

            expect(response).toMatchObject({
                isOk: true,
                statusCode: HttpStatusCode.OK,
                body: mockResponse,
            })

            expect(mockedRequest.isDone()).toBe(true)
            expect(observeSecondsSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    destination: `${baseUrl}|getUser`,
                }),
                expect.any(BigInt),
            )

            observeSecondsSpy.mockRestore()
        })

        it('should include metricLabel in metric destination on failed request', async () => {
            const path = '/users/123'
            const errorResponse = { message: 'Not Found' }

            const observeSecondsSpy = vi.spyOn(metricsMock.totalTimerMetric, 'observeSeconds')

            const mockedRequest = nock(baseUrl).get(path).reply(HttpStatusCode.NOT_FOUND, errorResponse)

            const response = await httpClientService.get(path, { metricLabel: 'getUser' })

            expect(response).toMatchObject({
                isOk: false,
                statusCode: HttpStatusCode.NOT_FOUND,
                body: errorResponse,
            })

            expect(mockedRequest.isDone()).toBe(true)
            expect(observeSecondsSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    destination: `${baseUrl}|getUser`,
                }),
                expect.any(BigInt),
            )

            observeSecondsSpy.mockRestore()
        })
    })

    describe('metricLabel type safety', () => {
        it('should accept constrained metricLabel types', async () => {
            type UserApiLabels = 'getUser' | 'createUser' | 'deleteUser'
            const typedHttpClient = new HttpClientService<UserApiLabels>(loggerMock, metricsMock, 'user-api', undefined, baseUrl)

            const path = '/users/123'
            const mockResponse = { id: '123' }

            const mockedRequest = nock(baseUrl).get(path).reply(HttpStatusCode.OK, mockResponse)

            const response = await typedHttpClient.get(path, { metricLabel: 'getUser' })

            expect(response.isOk).toBe(true)
            expect(mockedRequest.isDone()).toBe(true)
        })

        // eslint-disable-next-line vitest/expect-expect
        it('should have correct type constraints for metricLabel', () => {
            type UserApiLabels = 'getUser' | 'createUser' | 'deleteUser'

            // Valid labels should be assignable
            expectTypeOf<'getUser'>().toMatchTypeOf<UserApiLabels>()
            expectTypeOf<'createUser'>().toMatchTypeOf<UserApiLabels>()
            expectTypeOf<'deleteUser'>().toMatchTypeOf<UserApiLabels>()

            // Invalid label should NOT be assignable
            expectTypeOf<'invalidLabel'>().not.toMatchTypeOf<UserApiLabels>()

            // RequestOptions with constrained label requires metricLabel
            type ConstrainedOptions = RequestOptions<UserApiLabels>
            assertType<ConstrainedOptions>({ metricLabel: 'getUser' })
            assertType<ConstrainedOptions>({ metricLabel: 'createUser' })
            assertType<ConstrainedOptions>({ metricLabel: 'deleteUser' })

            // Verify metricLabel is required (not optional)
            expectTypeOf<ConstrainedOptions['metricLabel']>().toEqualTypeOf<UserApiLabels>()
        })

        // eslint-disable-next-line vitest/expect-expect
        it('should require generic type parameter for HttpClientService', () => {
            // HttpClientService requires a type parameter - no default
            type ClientWithLabels = HttpClientService<'label1' | 'label2'>
            type ClientGetMethod = ClientWithLabels['get']
            type ClientOptions = Parameters<ClientGetMethod>[1]

            // metricLabel should be required and match the generic type
            expectTypeOf<ClientOptions['metricLabel']>().toEqualTypeOf<'label1' | 'label2'>()
        })

        // eslint-disable-next-line vitest/expect-expect
        it('should reject broad string type via LowCardinality (resolves to never)', () => {
            // When using broad `string` type, metricLabel should become `never`
            type BroadStringOptions = RequestOptions<string>
            expectTypeOf<BroadStringOptions['metricLabel']>().toBeNever()

            // This prevents assignment of any value when `string` is used as type parameter
            // @ts-expect-error - cannot assign to never
            assertType<BroadStringOptions>({ metricLabel: 'anyValue' })
        })

        // eslint-disable-next-line vitest/expect-expect
        it('should accept string literal unions (not never)', () => {
            // String literal unions should work normally
            type ValidLabels = 'getUser' | 'createUser'
            type ValidOptions = RequestOptions<ValidLabels>

            // metricLabel should NOT be never when using proper union
            expectTypeOf<ValidOptions['metricLabel']>().not.toBeNever()
            expectTypeOf<ValidOptions['metricLabel']>().toEqualTypeOf<ValidLabels>()

            // Assignment should work
            assertType<ValidOptions>({ metricLabel: 'getUser' })
            assertType<ValidOptions>({ metricLabel: 'createUser' })
        })

        // eslint-disable-next-line vitest/expect-expect
        it('should accept single string literal (not never)', () => {
            // Even a single literal should work
            type SingleLabel = 'onlyLabel'
            type SingleOptions = RequestOptions<SingleLabel>

            expectTypeOf<SingleOptions['metricLabel']>().not.toBeNever()
            expectTypeOf<SingleOptions['metricLabel']>().toEqualTypeOf<SingleLabel>()

            assertType<SingleOptions>({ metricLabel: 'onlyLabel' })
        })
    })
})
