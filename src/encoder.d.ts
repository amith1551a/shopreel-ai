declare module 'h264-mp4-encoder/embuild/dist/h264-mp4-encoder.web.js' {
  const HME: { createH264MP4Encoder(): Promise<import('h264-mp4-encoder').H264MP4Encoder & { readonly wasmMemoryBytes: number }> };
  export default HME;
}
