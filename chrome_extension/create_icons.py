from PIL import Image, ImageDraw
import os

# 创建简单的录制图标
for size in [16, 48, 128]:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # 渐变色背景（简化为单色）
    draw.ellipse([0, 0, size-1, size-1], fill=(102, 126, 234, 255))
    
    # 中心录制圆点
    center_size = size // 3
    offset = (size - center_size) // 2
    draw.ellipse([offset, offset, offset+center_size, offset+center_size], 
                 fill=(255, 255, 255, 255))
    
    img.save(f'icon{size}.png')
    print(f'✅ 创建图标: icon{size}.png')

print('✅ 所有图标创建完成')
