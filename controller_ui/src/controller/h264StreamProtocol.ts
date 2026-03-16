export const H264MessageType = {
  VIDEO_FRAME: 0x01,
  INIT_DATA: 0x02,
  CONTROL: 0x03,
  STATS: 0x04,
} as const;

export class H264StreamProtocol {
  static readonly MAGIC = 0x48323634; // 'H264'
  static readonly HEADER_SIZE = 17;

  static unpackMessage(buffer: ArrayBuffer): { type: number; payload: Uint8Array; pts: number } {
    const view = new DataView(buffer);
    if (buffer.byteLength < H264StreamProtocol.HEADER_SIZE) {
      throw new Error(`Data too short: ${buffer.byteLength} < ${H264StreamProtocol.HEADER_SIZE}`);
    }

    const magic = view.getUint32(0, false);
    const msgType = view.getUint8(4);
    const length = view.getUint32(5, false);

    const ptsHigh = view.getUint32(9, false);
    const ptsLow = view.getUint32(13, false);
    const pts = ptsHigh * 0x100000000 + ptsLow;

    if (magic !== H264StreamProtocol.MAGIC) {
      throw new Error(`Invalid magic: 0x${magic.toString(16)}, expected 0x${H264StreamProtocol.MAGIC.toString(16)}`);
    }

    const payload = new Uint8Array(buffer, H264StreamProtocol.HEADER_SIZE, length);
    return { type: msgType, payload, pts };
  }

  static unpackVideoFrame(buffer: ArrayBuffer): { h264Data: Uint8Array; pts: number; isKeyframe: boolean } {
    const { type, payload, pts } = H264StreamProtocol.unpackMessage(buffer);
    if (type !== H264MessageType.VIDEO_FRAME) {
      throw new Error(`Not a video frame: type=${type}`);
    }

    const flags = payload[0];
    const isKeyframe = (flags & 1) === 1;
    const h264Data = payload.subarray(1);
    return { h264Data, pts, isKeyframe };
  }

  static unpackInitData(buffer: ArrayBuffer): Uint8Array {
    const { type, payload } = H264StreamProtocol.unpackMessage(buffer);
    if (type !== H264MessageType.INIT_DATA) {
      throw new Error(`Not init data: type=${type}`);
    }
    return payload;
  }
}

