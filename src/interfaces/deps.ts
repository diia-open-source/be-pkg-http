import { HttpClientService, HttpService } from '../services'

export type HttpDeps = {
    httpService: HttpService
    httpsService: HttpService
    http?: HttpClientService
}
