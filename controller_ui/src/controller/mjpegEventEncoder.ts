export class MJPEGEventEncoder {
  private readonly EventType = {
    MOUSE_MOVE: 0,
    MOUSE_DOWN: 1,
    MOUSE_UP: 2,
    MOUSE_CLICK: 3,
    MOUSE_DBLCLICK: 4,
    MOUSE_WHEEL: 5,
    KEY_DOWN: 6,
    KEY_UP: 7,
    KEY_PRESS: 8,
  } as const;

  stats = {
    mouseEvents: 0,
    wheelEvents: 0,
    keyEvents: 0,
    totalBytes: 0,
    errors: 0,
  };

  constructor() {
    // Keep console output identical-ish to legacy for debugging.
    console.log("🔧 [BinaryEncoder] MJPEG/WebRTC二进制事件编码器已初始化");
  }

  encodeMouseEvent(type: string, x: number, y: number, button = 0): ArrayBuffer | null {
    try {
      const typeMap: Record<string, number> = {
        mousemove: this.EventType.MOUSE_MOVE,
        mousedown: this.EventType.MOUSE_DOWN,
        mouseup: this.EventType.MOUSE_UP,
        click: this.EventType.MOUSE_CLICK,
        dblclick: this.EventType.MOUSE_DBLCLICK,
      };

      const eventType = typeMap[type];
      if (eventType === undefined) {
        console.error("❌ [BinaryEncoder] 未知鼠标事件类型:", type);
        this.stats.errors++;
        return null;
      }

      const clampedX = Math.max(0, Math.min(65535, Math.round(x)));
      const clampedY = Math.max(0, Math.min(65535, Math.round(y)));
      const clampedButton = Math.max(0, Math.min(255, button));

      const timestamp = Date.now();

      // 13 bytes: [type:1][x:2][y:2][button:1][timestamp:4][reserved:3]
      const buffer = new ArrayBuffer(13);
      const view = new DataView(buffer);

      view.setUint8(0, eventType);
      view.setUint16(1, clampedX, false);
      view.setUint16(3, clampedY, false);
      view.setUint8(5, clampedButton);
      view.setUint32(6, timestamp, false);
      // remaining 3 bytes are 0

      this.stats.mouseEvents++;
      this.stats.totalBytes += 13;

      return buffer;
    } catch (error) {
      console.error("❌ [BinaryEncoder] 编码鼠标事件失败:", error);
      this.stats.errors++;
      return null;
    }
  }

  encodeWheelEvent(x: number, y: number, deltaY: number, deltaX = 0): ArrayBuffer | null {
    try {
      const clampedX = Math.max(0, Math.min(65535, Math.round(x)));
      const clampedY = Math.max(0, Math.min(65535, Math.round(y)));
      const clampedDeltaY = Math.max(-2147483648, Math.min(2147483647, Math.round(deltaY)));
      const clampedDeltaX = Math.max(-2147483648, Math.min(2147483647, Math.round(deltaX)));

      const timestamp = Date.now();

      // 17 bytes: [type:1][x:2][y:2][deltaY:4][deltaX:4][timestamp:4]
      const buffer = new ArrayBuffer(17);
      const view = new DataView(buffer);

      view.setUint8(0, this.EventType.MOUSE_WHEEL);
      view.setUint16(1, clampedX, false);
      view.setUint16(3, clampedY, false);
      view.setInt32(5, clampedDeltaY, false);
      view.setInt32(9, clampedDeltaX, false);
      view.setUint32(13, timestamp, false);

      this.stats.wheelEvents++;
      this.stats.totalBytes += 17;

      return buffer;
    } catch (error) {
      console.error("❌ [BinaryEncoder] 编码滚轮事件失败:", error);
      this.stats.errors++;
      return null;
    }
  }

  encodeKeyboardEvent(type: string, key: string, keyCode: number, modifiers: number): ArrayBuffer | null {
    try {
      const typeMap: Record<string, number> = {
        keydown: this.EventType.KEY_DOWN,
        keyup: this.EventType.KEY_UP,
        keypress: this.EventType.KEY_PRESS,
      };

      const eventType = typeMap[type];
      if (eventType === undefined) {
        console.error("❌ [BinaryEncoder] 未知键盘事件类型:", type);
        this.stats.errors++;
        return null;
      }

      const clampedKeyCode = Math.max(0, Math.min(65535, keyCode || 0));
      const clampedModifiers = Math.max(0, Math.min(255, modifiers || 0));

      const keyStr = key || "";
      const keyBytes = new TextEncoder().encode(keyStr);
      const timestamp = Date.now();

      const buffer = new ArrayBuffer(8 + keyBytes.length);
      const view = new DataView(buffer);

      view.setUint8(0, eventType);
      view.setUint16(1, clampedKeyCode, false);
      view.setUint8(3, clampedModifiers);
      view.setUint32(4, timestamp, false);

      new Uint8Array(buffer).set(keyBytes, 8);

      this.stats.keyEvents++;
      this.stats.totalBytes += buffer.byteLength;

      return buffer;
    } catch (error) {
      console.error("❌ [BinaryEncoder] 编码键盘事件失败:", error);
      this.stats.errors++;
      return null;
    }
  }

  encode(event: Record<string, unknown> | null | undefined): ArrayBuffer | null {
    if (!event || typeof event.type !== "string") {
      console.error("❌ [BinaryEncoder] 无效的事件对象");
      this.stats.errors++;
      return null;
    }

    const type = event.type;

    if (type === "wheel") {
      return this.encodeWheelEvent(
        Number(event.x || 0),
        Number(event.y || 0),
        Number(event.deltaY || 0),
        Number(event.deltaX || 0),
      );
    }

    if (type.startsWith("key")) {
      const modifiers =
        (event.ctrlKey ? 1 : 0) | (event.shiftKey ? 2 : 0) | (event.altKey ? 4 : 0) | (event.metaKey ? 8 : 0);
      return this.encodeKeyboardEvent(type, String(event.key || ""), Number(event.keyCode || 0), modifiers);
    }

    if (type === "mousemove" || type === "mousedown" || type === "mouseup" || type === "click" || type === "dblclick") {
      return this.encodeMouseEvent(type, Number(event.x || 0), Number(event.y || 0), Number(event.button || 0));
    }

    console.warn("⚠️ [BinaryEncoder] 不支持的事件类型:", type);
    this.stats.errors++;
    return null;
  }

  getStats() {
    const totalEvents = this.stats.mouseEvents + this.stats.wheelEvents + this.stats.keyEvents;
    return {
      ...this.stats,
      avgBytesPerEvent: this.stats.totalBytes / (totalEvents || 1),
    };
  }

  resetStats() {
    this.stats = {
      mouseEvents: 0,
      wheelEvents: 0,
      keyEvents: 0,
      totalBytes: 0,
      errors: 0,
    };
    console.log("🔄 [BinaryEncoder] 统计信息已重置");
  }

  printStats() {
    const stats = this.getStats();
    console.log("📊 [BinaryEncoder] 统计信息:");
    console.log(`  鼠标事件: ${stats.mouseEvents}`);
    console.log(`  滚轮事件: ${stats.wheelEvents}`);
    console.log(`  键盘事件: ${stats.keyEvents}`);
    console.log(`  总字节数: ${stats.totalBytes}`);
    console.log(`  平均每事件: ${stats.avgBytesPerEvent.toFixed(1)}字节`);
    console.log(`  错误次数: ${stats.errors}`);
  }
}

