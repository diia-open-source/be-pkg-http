import { HttpClientService } from '../services/index.js'

export type HttpDeps<TMetricLabel extends string> = {
    http?: HttpClientService<TMetricLabel>
}
