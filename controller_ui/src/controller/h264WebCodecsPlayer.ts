type VideoDecoderLike = any;
type EncodedVideoChunkLike = any;

export class H264WebCodecsPlayer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private decoder: VideoDecoderLike | null = null;
  private isReady = false;

  private config = {
    codec: "avc1.640028",
    codedWidth: 1920,
    codedHeight: 1080,
    hardwareAcceleration: "prefer-hardware",
    optimizeForLatency: true,
  };

  private stats = {
    totalFrames: 0,
    keyframes: 0,
    decodedFrames: 0,
    droppedFrames: 0,
    decodeErrors: 0,
    bytesReceived: 0,
    avgDecodeTime: 0,
  };

  private decodeStartTime = 0;
  private decodeTimes: number[] = [];

  constructor(canvasElement: HTMLCanvasElement) {
    this.canvas = canvasElement;
    const ctx = canvasElement.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2d context unavailable");
    this.ctx = ctx;
    console.log("🎬 [H264-WebCodecs] 播放器已创建");
  }

  async init(): Promise<void> {
    if (typeof (window as any).VideoDecoder === "undefined") {
      throw new Error("浏览器不支持WebCodecs API (需要Chrome 94+)");
    }

    console.log("✅ [H264-WebCodeCs] WebCodecs API支持");

    this.decoder = new (window as any).VideoDecoder({
      output: (frame: any) => this.handleFrame(frame),
      error: (error: any) => this.handleError(error),
    });

    this.decoder.configure(this.config);

    console.log("✅ [H264-WebCodecs] 解码器已配置:", this.config);
    this.isReady = true;
  }

  private handleFrame(frame: any) {
    try {
      if (this.decodeStartTime > 0) {
        const decodeTime = performance.now() - this.decodeStartTime;
        this.decodeTimes.push(decodeTime);
        if (this.decodeTimes.length > 100) this.decodeTimes.shift();
        const sum = this.decodeTimes.reduce((a, b) => a + b, 0);
        this.stats.avgDecodeTime = sum / this.decodeTimes.length;
      }

      this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
      this.stats.decodedFrames++;
      frame.close();
    } catch (error) {
      console.error("❌ [H264-WebCodecs] 渲染帧失败:", error);
      this.stats.droppedFrames++;
    }
  }

  private handleError(error: any) {
    console.error("❌ [H264-WebCodecs] 解码错误:", error);
    this.stats.decodeErrors++;

    if (this.decoder && this.decoder.state === "closed") {
      try {
        this.decoder.configure(this.config);
        console.log("🔄 [H264-WebCodecs] 解码器已重新配置");
      } catch (e) {
        console.error("❌ [H264-WebCodecs] 重新配置失败:", e);
      }
    }
  }

  receiveInitData(initData: Uint8Array) {
    console.log(`📦 [H264-WebCodecs] 收到初始化数据: ${initData.byteLength} bytes`);
    (this as any).initData = initData;
  }

  receiveFrame(h264Data: Uint8Array, pts: number, isKeyframe: boolean) {
    if (!this.isReady || !this.decoder) {
      console.warn("⚠️ [H264-WebCodecs] 解码器未就绪");
      return;
    }

    this.stats.totalFrames++;
    this.stats.bytesReceived += h264Data.byteLength;
    if (isKeyframe) this.stats.keyframes++;

    try {
      const EncodedVideoChunkCtor: EncodedVideoChunkLike = (window as any).EncodedVideoChunk;
      const chunk = new EncodedVideoChunkCtor({
        type: isKeyframe ? "key" : "delta",
        timestamp: pts,
        data: h264Data,
      });

      this.decodeStartTime = performance.now();
      this.decoder.decode(chunk);
    } catch (error) {
      console.error("❌ [H264-WebCodecs] 解码失败:", error);
      this.stats.decodeErrors++;
    }
  }

  getStats() {
    const lossRate = (this.stats.droppedFrames / Math.max(1, this.stats.totalFrames)) * 100;
    return {
      ...this.stats,
      state: this.decoder ? this.decoder.state : "not initialized",
      queueSize: this.decoder ? this.decoder.decodeQueueSize : 0,
      avgDecodeTimeMs: this.stats.avgDecodeTime.toFixed(2),
      lossRate: lossRate.toFixed(2) + "%",
    };
  }

  async reset() {
    console.log("🔄 [H264-WebCodecs] 重置播放器");
    if (this.decoder) {
      try {
        await this.decoder.flush();
        this.decoder.reset();
      } catch (e) {
        console.error("❌ [H264-WebCodecs] 重置失败:", e);
      }
    }
    this.stats = {
      totalFrames: 0,
      keyframes: 0,
      decodedFrames: 0,
      droppedFrames: 0,
      decodeErrors: 0,
      bytesReceived: 0,
      avgDecodeTime: 0,
    };
    this.decodeTimes = [];
  }

  async destroy() {
    console.log("🛑 [H264-WebCodecs] 销毁播放器");
    if (this.decoder) {
      try {
        await this.decoder.flush();
        this.decoder.close();
      } catch (e) {
        console.error("❌ [H264-WebCodecs] 关闭解码器失败:", e);
      }
    }
    this.isReady = false;
    this.decoder = null;
  }

  static isSupported() {
    return typeof (window as any).VideoDecoder !== "undefined" && typeof (window as any).EncodedVideoChunk !== "undefined";
  }
}

