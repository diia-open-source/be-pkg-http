import { PeerCertificateWithSHA256 } from '@diia-inhouse/types'

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const waitAndRun = async <T extends (...params: []) => Promise<any>>(callback: T, ms: number): Promise<ReturnType<T>> => {
    await sleep(ms)

    return await callback()
}

export function checkServerIdentity(hostFingerprint: string): (host: string, cert: PeerCertificateWithSHA256) => Error | undefined {
    return (host: string, cert: PeerCertificateWithSHA256) => {
        const certFingerprint: string = cert.fingerprint256 || cert.fingerprint

        if (!hostFingerprint || hostFingerprint === certFingerprint) {
            return
        }

        return new Error(`Fingerprint for host ${host} does not match`)
    }
}
