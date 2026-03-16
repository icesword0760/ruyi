export class H264MSEPlayer {
  private video: HTMLVideoElement;
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private queue: Uint8Array[] = [];
  private isUpdating = false;
  private isReady = false;

  private stats = {
    totalFrames: 0,
    keyframes: 0,
    droppedFrames: 0,
    bytesReceived: 0,
  };

  private initData: Uint8Array | null = null;
  private initSegment: Uint8Array | null = null;

  constructor(videoElement: HTMLVideoElement) {
    this.video = videoElement;
    console.log("🎬 [H264-MSE] 播放器已创建");
  }

  async init(): Promise<void> {
    if (typeof MediaSource === "undefined") {
      throw new Error("浏览器不支持MediaSource API");
    }

    const codec = 'video/mp4; codecs="avc1.640028"';
    if (!MediaSource.isTypeSupported(codec)) {
      throw new Error(`浏览器不支持编解码器: ${codec}`);
    }

    console.log(`✅ [H264-MSE] 编解码器支持: ${codec}`);

    this.mediaSource = new MediaSource();
    this.video.src = URL.createObjectURL(this.mediaSource);

    await new Promise<void>((resolve, reject) => {
      if (!this.mediaSource) return reject(new Error("MediaSource unavailable"));

      const onError = (e: Event) => {
        console.error("❌ [H264-MSE] MediaSource错误:", e);
        reject(e);
      };

      const onOpen = () => {
        try {
          if (!this.mediaSource) return;
          this.sourceBuffer = this.mediaSource.addSourceBuffer(codec);
          this.sourceBuffer.mode = "sequence";
          this.sourceBuffer.addEventListener("updateend", () => {
            this.isUpdating = false;
            this.processQueue();
          });
          this.sourceBuffer.addEventListener("error", (e) => {
            console.error("❌ [H264-MSE] SourceBuffer错误:", e);
          });
          this.isReady = true;
          console.log("✅ [H264-MSE] SourceBuffer已创建");
          resolve();
        } catch (error) {
          console.error("❌ [H264-MSE] 创建SourceBuffer失败:", error);
          reject(error);
        } finally {
          this.mediaSource?.removeEventListener("error", onError);
        }
      };

      this.mediaSource.addEventListener("sourceopen", onOpen, { once: true });
      this.mediaSource.addEventListener("error", onError);
    });
  }

  receiveInitData(initData: Uint8Array) {
    console.log(`📦 [H264-MSE] 收到初始化数据: ${initData.byteLength} bytes`);
    this.initData = initData;
    this.initSegment = this.generateInitSegment(initData);
    if (this.isReady && !this.isUpdating) {
      this.appendInitSegment();
    }
  }

  private generateInitSegment(initData: Uint8Array): Uint8Array {
    // Legacy implementation is a placeholder; keep parity.
    console.warn("⚠️ [H264-MSE] 需要fMP4封装库 (mp4box.js/mux.js)");
    return initData;
  }

  private appendInitSegment() {
    if (!this.initSegment || !this.sourceBuffer || this.isUpdating) return;
    try {
      this.isUpdating = true;
      this.sourceBuffer.appendBuffer(this.initSegment);
      console.log("✅ [H264-MSE] 初始化片段已添加");
    } catch (error) {
      console.error("❌ [H264-MSE] 添加初始化片段失败:", error);
      this.isUpdating = false;
    }
  }

  receiveFrame(h264Data: Uint8Array, pts: number, isKeyframe: boolean) {
    this.stats.totalFrames++;
    this.stats.bytesReceived += h264Data.byteLength;
    if (isKeyframe) this.stats.keyframes++;

    const mediaSegment = this.wrapInFMP4(h264Data, pts, isKeyframe);
    this.queue.push(mediaSegment);
    this.processQueue();
  }

  private wrapInFMP4(h264Data: Uint8Array, pts: number, isKeyframe: boolean): Uint8Array {
    console.debug(`🎬 [H264-MSE] 帧: ${h264Data.byteLength}B, PTS=${pts}, keyframe=${isKeyframe}`);
    return h264Data;
  }

  private processQueue() {
    if (!this.isReady || this.isUpdating || this.queue.length === 0) return;
    if (!this.sourceBuffer) {
      console.error("❌ [H264-MSE] SourceBuffer未就绪");
      return;
    }

    try {
      const segment = this.queue.shift();
      if (!segment) return;
      this.isUpdating = true;
      this.sourceBuffer.appendBuffer(segment);
    } catch (error) {
      console.error("❌ [H264-MSE] 添加媒体片段失败:", error);
      this.isUpdating = false;
      this.stats.droppedFrames++;
    }
  }

  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      isReady: this.isReady,
      isUpdating: this.isUpdating,
      currentTime: this.video.currentTime,
      buffered: this.sourceBuffer ? this.sourceBuffer.buffered.length : 0,
    };
  }

  destroy() {
    console.log("🛑 [H264-MSE] 销毁播放器");
    if (this.sourceBuffer) {
      try {
        if (this.mediaSource && this.mediaSource.readyState === "open") {
          this.mediaSource.removeSourceBuffer(this.sourceBuffer);
        }
      } catch (e) {
        console.error("❌ [H264-MSE] 移除SourceBuffer失败:", e);
      }
    }

    if (this.mediaSource) {
      try {
        if (this.mediaSource.readyState === "open") {
          this.mediaSource.endOfStream();
        }
      } catch (e) {
        console.error("❌ [H264-MSE] 结束MediaSource失败:", e);
      }
    }

    this.queue = [];
    this.isReady = false;
  }
}

