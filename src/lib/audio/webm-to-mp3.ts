/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Converte um Blob de áudio (webm/ogg) para MP3 usando lamejs.
 * Roda 100% no browser — sem dependência de servidor.
 */
export async function convertToMp3(audioBlob: Blob): Promise<File> {
    const lamejs = (await import('lamejs')) as any
    const Mp3Encoder = lamejs.default?.Mp3Encoder ?? lamejs.Mp3Encoder

    const arrayBuffer = await audioBlob.arrayBuffer()
    const audioCtx = new AudioContext()
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
    await audioCtx.close()

    const sampleRate = audioBuffer.sampleRate
    const samples = audioBuffer.getChannelData(0) // mono

    // Float32 → Int16
    const int16 = new Int16Array(samples.length)
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]))
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }

    // Encode MP3
    const encoder = new Mp3Encoder(1, sampleRate, 128)
    const blockSize = 1152
    const mp3Parts: Uint8Array[] = []

    for (let i = 0; i < int16.length; i += blockSize) {
        const chunk = int16.subarray(i, i + blockSize)
        const buf = encoder.encodeBuffer(chunk)
        if (buf.length > 0) mp3Parts.push(new Uint8Array(buf))
    }
    const end = encoder.flush()
    if (end.length > 0) mp3Parts.push(new Uint8Array(end))

    const mp3Blob = new Blob(mp3Parts as BlobPart[], { type: 'audio/mpeg' })
    return new File([mp3Blob], `audio-${Date.now()}.mp3`, { type: 'audio/mpeg' })
}
