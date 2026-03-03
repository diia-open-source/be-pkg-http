import { HttpClientService } from '../services'

export type HttpDeps<TMetricLabel extends string> = {
    http?: HttpClientService<TMetricLabel>
}
