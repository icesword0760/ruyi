"""
Patch aiortc's VP8 encoder for high-quality screen sharing

This module monkey-patches aiortc's video encoder to use optimal
parameters for screen sharing scenarios.
"""

import logging

LOGGER = logging.getLogger(__name__)

def patch_vp8_encoder():
    """
    Patch aiortc's VP8 encoder with high-quality screen sharing parameters.
    
    This increases bitrate and optimizes for screen content (text/UI) rather
    than natural video.
    """
    try:
        from aiortc.codecs import vpx
        import av
        
        # Store original encode method
        original_encode = vpx.Vp8Encoder.encode
        
        # Track if we've already configured
        configured = {}
        
        def patched_encode(self, frame, force_keyframe=False):
            # Configure codec on first encode
            if id(self) not in configured:
                try:
                    if hasattr(self, '_codec') and self._codec:
                        codec = self._codec
                        
                        # Configure codec options for screen sharing
                        # bit_rate is the most critical parameter
                        # INCREASED for better dynamic content quality
                        codec.bit_rate = 15_000_000  # 15 Mbps (increased from 10 Mbps)
                        codec.bit_rate_tolerance = 5_000_000  # Higher tolerance for peaks
                        
                        # Quality control - MORE AGGRESSIVE for dynamic content
                        codec.qmin = 2   # Lower minimum (better quality floor)
                        codec.qmax = 42  # Lower maximum (prevent severe compression)
                        
                        # 🔥 改进5: 更短的关键帧间隔（借鉴货拉拉）
                        # Every 1 second at 30fps (从60改为30)
                        # 提升动态画面质量和错误恢复速度
                        codec.gop_size = 30
                        
                        # Screen content optimization with MAXIMUM QUALITY
                        if hasattr(codec, 'options'):
                            codec.options = {
                                'deadline': 'good',  # Changed from 'realtime' - better quality
                                'cpu-used': '0',  # MAXIMUM QUALITY (slowest but best)
                                'tune': 'screen',  # Screen content tuning
                                'quality': 'best',  # Best quality mode
                                'static-thresh': '0',  # Disable static detection (helps with dynamic)
                                'lag-in-frames': '0',  # No lag for real-time
                                'error-resilient': '0',  # Not needed for WebRTC
                                'auto-alt-ref': '0',  # Disable for low latency
                                **codec.options
                            }
                        
                        configured[id(self)] = True
                        LOGGER.info("✅ VP8 encoder configured: 10Mbps bitrate, screen-optimized")
                except Exception as e:
                    LOGGER.warning(f"Could not fully configure VP8 encoder: {e}")
                    configured[id(self)] = True
            
            # Call original encode
            return original_encode(self, frame, force_keyframe)
        
        # Apply patch
        vpx.Vp8Encoder.encode = patched_encode
        LOGGER.info("VP8 encoder patch applied successfully")
        return True
        
    except ImportError as e:
        LOGGER.warning(f"Could not import aiortc.codecs.vpx: {e}")
        return False
    except Exception as e:
        LOGGER.error(f"Failed to patch VP8 encoder: {e}")
        return False


def patch_h264_encoder():
    """
    Patch aiortc's H.264 encoder with high-quality screen sharing parameters.
    """
    try:
        from aiortc.codecs import h264
        
        original_encode = h264.H264Encoder.encode
        configured = {}
        
        def patched_encode(self, frame, force_keyframe=False):
            if id(self) not in configured:
                try:
                    if hasattr(self, '_codec') and self._codec:
                        codec = self._codec
                        
                        # High bitrate
                        codec.bit_rate = 10_000_000  # 10 Mbps
                        codec.bit_rate_tolerance = 3_000_000
                        
                        # Quality settings
                        codec.qmin = 10
                        codec.qmax = 40
                        codec.gop_size = 120
                        
                        # H.264 screen content options
                        if hasattr(codec, 'options'):
                            codec.options = {
                                'preset': 'medium',
                                'tune': 'zerolatency',  # For screen sharing
                                'crf': '18',  # High quality
                                **codec.options
                            }
                        
                        configured[id(self)] = True
                        LOGGER.info("✅ H.264 encoder configured: 10Mbps bitrate")
                except Exception as e:
                    LOGGER.warning(f"Could not fully configure H.264 encoder: {e}")
                    configured[id(self)] = True
            
            return original_encode(self, frame, force_keyframe)
        
        h264.H264Encoder.encode = patched_encode
        LOGGER.info("H.264 encoder patch applied successfully")
        return True
        
    except ImportError:
        LOGGER.warning("Could not import aiortc.codecs.h264")
        return False
    except Exception as e:
        LOGGER.error(f"Failed to patch H.264 encoder: {e}")
        return False


def apply_all_patches():
    """Apply all encoder patches for optimal screen sharing quality."""
    vp8_result = patch_vp8_encoder()
    h264_result = patch_h264_encoder()
    
    if vp8_result or h264_result:
        LOGGER.info("🎯 Encoder patches applied - screen sharing optimized for high quality")
        return True
    else:
        LOGGER.warning("⚠️  Encoder patches could not be applied - using default settings")
        return False

