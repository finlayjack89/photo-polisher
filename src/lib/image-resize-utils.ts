/**
 * Utility functions for resizing images to prevent Edge Function memory issues
 */

/**
 * Smart two-step image processing: resize to 2048px max, then compress iteratively if needed
 * Ensures maximum quality while staying under 5MB
 */

/**
 * Calculate new dimensions that fit within max bounds while maintaining aspect ratio
 */
export const calculateResizedDimensions = (
  originalWidth: number, 
  originalHeight: number, 
  maxWidth: number, 
  maxHeight: number
): { width: number; height: number } => {
  if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
    return { width: originalWidth, height: originalHeight };
  }

  const widthRatio = maxWidth / originalWidth;
  const heightRatio = maxHeight / originalHeight;
  const ratio = Math.min(widthRatio, heightRatio);

  return {
    width: Math.round(originalWidth * ratio),
    height: Math.round(originalHeight * ratio)
  };
};

/**
 * Check if an image needs resizing based on maximum dimensions
 */
export const needsResizing = (file: File, maxWidth: number, maxHeight: number): Promise<boolean> => {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      resolve(false);
      return;
    }

    const img = new Image();
    img.onload = () => {
      const needs = img.naturalWidth > maxWidth || img.naturalHeight > maxHeight;
      resolve(needs);
    };
    img.onerror = () => resolve(false);
    img.src = URL.createObjectURL(file);
  });
};

/**
 * Get image dimensions from a File
 */
export const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('File is not an image'));
      return;
    }

    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
};

/**
 * Smart two-step image processing: resize to 2048px max, then compress iteratively if needed
 * Ensures maximum quality while staying under 5MB
 */
export const processAndCompressImage = (file: File): Promise<File> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Could not get canvas context'));

        // Step A: Resize to 2048px max (longest side) while maintaining aspect ratio
        const maxDimension = 2048;
        let { width, height } = img.naturalWidth > img.naturalHeight 
          ? { width: maxDimension, height: Math.round((img.naturalHeight * maxDimension) / img.naturalWidth) }
          : { width: Math.round((img.naturalWidth * maxDimension) / img.naturalHeight), height: maxDimension };

        // If image is already smaller than 2048px, keep original dimensions
        if (img.naturalWidth <= maxDimension && img.naturalHeight <= maxDimension) {
          width = img.naturalWidth;
          height = img.naturalHeight;
        }

        canvas.width = width;
        canvas.height = height;

        // Draw resized image
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to high-quality JPEG blob (0.98 quality)
        canvas.toBlob(async (initialBlob) => {
          if (!initialBlob) return reject(new Error('Failed to create initial blob'));
          
          const targetSizeBytes = 5 * 1024 * 1024; // 5MB

          // Step B: Check if already under 5MB
          if (initialBlob.size <= targetSizeBytes) {
            const finalFile = new File([initialBlob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now()
            });
            resolve(finalFile);
            return;
          }

          // Step B: Iterative compression if needed
          let currentQuality = 0.96;
          const qualityStep = 0.02;
          let bestBlob = initialBlob;

          while (currentQuality >= 0.5 && bestBlob.size > targetSizeBytes) {
            await new Promise<void>((resolveCompress) => {
              canvas.toBlob((compressedBlob) => {
                if (compressedBlob && compressedBlob.size <= targetSizeBytes) {
                  bestBlob = compressedBlob;
                }
                resolveCompress();
              }, 'image/jpeg', currentQuality);
            });

            if (bestBlob.size <= targetSizeBytes) break;
            currentQuality -= qualityStep;
          }

          const finalFile = new File([bestBlob], file.name, {
            type: 'image/jpeg',
            lastModified: Date.now()
          });
          
          resolve(finalFile);
        }, 'image/jpeg', 0.98);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
};