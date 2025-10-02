/**
 * Canvas utilities for AI commercial photo editing workflow
 * Only includes essential functions - Cloudinary handles compositing
 */

/**
 * Step 3: Client-Side Mask Correction
 * Converts black areas in AI-generated masks to transparent
 */
export const convertBlackToTransparent = (imageDataUrl: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject('Could not get canvas context');

      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        // If pixel is black or near-black, make it transparent
        if (data[i] < 50 && data[i + 1] < 50 && data[i + 2] < 50) {
          data[i + 3] = 0; // Set alpha channel to 0 (fully transparent)
        }
      }
      
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = reject;
    image.src = imageDataUrl;
  });
};

/**
 * Step 4: Client-Side Background Removal
 * Uses corrected mask to perform pixel-perfect cutout
 */
export const applyMaskToImage = (originalImageDataUrl: string, maskImageDataUrl: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const originalImage = new Image();
    const maskImage = new Image();
    let loadedCount = 0;

    const onImageLoad = () => {
      loadedCount++;
      if (loadedCount === 2) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = originalImage.naturalWidth;
          canvas.height = originalImage.naturalHeight;
          const ctx = canvas.getContext('2d');
          
          if (!ctx) return reject('Could not get canvas context');

          // 1. Draw the original image
          ctx.drawImage(originalImage, 0, 0);

          // 2. Set composite operation: keeps destination pixels that are within the source
          ctx.globalCompositeOperation = 'destination-in';

          // 3. Draw the mask, scaled to fit, on top to perform the "cut"
          ctx.drawImage(maskImage, 0, 0, canvas.width, canvas.height);

          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      }
    };

    originalImage.onload = onImageLoad;
    maskImage.onload = onImageLoad;
    originalImage.onerror = reject;
    maskImage.onerror = reject;
    
    originalImage.src = originalImageDataUrl;
    maskImage.src = maskImageDataUrl;
  });
};

/**
 * Find the lowest alpha pixel in a subject image to determine ground contact point
 */
export const findLowestAlphaPixel = (imageDataUrl: string): Promise<number> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject('Could not get canvas context');

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Scan from bottom to top to find the lowest non-transparent pixel
      for (let y = canvas.height - 1; y >= 0; y--) {
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          const alpha = data[i + 3];
          if (alpha > 50) { // Consider pixels with >50 alpha as solid
            resolve(y); // Return Y coordinate of lowest solid pixel
            return;
          }
        }
      }
      resolve(canvas.height); // Fallback if no solid pixels found
    };
    img.onerror = reject;
    img.src = imageDataUrl;
  });
};

/**
 * Step 5: Client-Side Compositing with Baseline Anchoring
 * Clips AI effects below the floor baseline and enforces correct layer order
 */
export const compositeLayers = (
  backdropDataUrl: string,
  subjectDataUrl: string,
  shadowLayerDataUrl: string | null,
  placement: { x: number; y: number; scale: number },
  baseline: number, // Y coordinate of floor in canvas pixels
  options?: {
    shadowOpacity?: number; // 0-1, default 1
    debugBaseline?: boolean; // Draw red line at baseline for debugging
  }
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const backdrop = new Image();
    const subject = new Image();
    const shadowLayer = shadowLayerDataUrl ? new Image() : null;
    let loadedCount = 0;
    const totalToLoad = shadowLayer ? 3 : 2;

    const onImageLoad = () => {
      loadedCount++;
      if (loadedCount === totalToLoad) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = backdrop.naturalWidth;
          canvas.height = backdrop.naturalHeight;
          const ctx = canvas.getContext('2d');
          
          if (!ctx) return reject('Could not get canvas context');

          // 1. Draw backdrop
          ctx.drawImage(backdrop, 0, 0);

          // 2. Draw AI shadow/reflection layer CLIPPED TO FLOOR
          if (shadowLayer) {
            ctx.save();
            
            // Clip to floor area (below baseline)
            ctx.beginPath();
            ctx.rect(0, baseline, canvas.width, canvas.height - baseline);
            ctx.clip();

            // Apply opacity if specified
            if (options?.shadowOpacity !== undefined && options.shadowOpacity < 1) {
              ctx.globalAlpha = options.shadowOpacity;
            }

            ctx.drawImage(shadowLayer, 0, 0, canvas.width, canvas.height);
            
            ctx.restore();
          }

          // 3. Draw subject LAST (on top of everything)
          const scaledWidth = subject.naturalWidth * placement.scale;
          const scaledHeight = subject.naturalHeight * placement.scale;
          const dx = placement.x * canvas.width;
          const dy = placement.y * canvas.height;
          
          ctx.drawImage(subject, dx, dy, scaledWidth, scaledHeight);

          // 4. Debug overlay (optional)
          if (options?.debugBaseline) {
            // Red line at baseline
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, baseline);
            ctx.lineTo(canvas.width, baseline);
            ctx.stroke();

            // Translucent band below baseline
            ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
            ctx.fillRect(0, baseline, canvas.width, Math.min(16, canvas.height - baseline));
          }

          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      }
    };

    backdrop.onload = onImageLoad;
    subject.onload = onImageLoad;
    if (shadowLayer) shadowLayer.onload = onImageLoad;
    
    backdrop.onerror = reject;
    subject.onerror = reject;
    if (shadowLayer) shadowLayer.onerror = reject;
    
    backdrop.src = backdropDataUrl;
    subject.src = subjectDataUrl;
    if (shadowLayer) shadowLayer.src = shadowLayerDataUrl!;
  });
};

/**
 * Utility to get image dimensions from data URL
 */
export const getImageDimensions = (dataUrl: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
};

/**
 * Convert File to data URL
 */
export const fileToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        resolve(e.target.result as string);
      } else {
        reject('Failed to read file');
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Create a preview image for display purposes (with max dimensions)
 */
export const createPreviewImage = (dataUrl: string, maxWidth: number = 400, maxHeight: number = 400): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) return reject('Could not get canvas context');

      // Calculate scaled dimensions
      let { width, height } = img;
      const aspectRatio = width / height;

      if (width > maxWidth) {
        width = maxWidth;
        height = width / aspectRatio;
      }
      if (height > maxHeight) {
        height = maxHeight;
        width = height * aspectRatio;
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
};
