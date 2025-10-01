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
