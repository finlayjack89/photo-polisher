/**
 * Utility functions for resizing images to prevent Edge Function memory issues
 */

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
export const processAndCompressImage = (file: File): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('Failed to get canvas context'));
        }
        
        const MAX_DIMENSION = 2048;
        let { width, height } = img;
        if (width > height) {
          if (width > MAX_DIMENSION) {
            height *= MAX_DIMENSION / width;
            width = MAX_DIMENSION;
          }
        } else {
          if (height > MAX_DIMENSION) {
            width *= MAX_DIMENSION / height;
            height = MAX_DIMENSION;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        
        const targetSizeInBytes = 5 * 1024 * 1024;
        
        // First, attempt to get a high-quality blob
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              return reject(new Error('Canvas toBlob returned null'));
            }
            if (blob.size <= targetSizeInBytes) {
              // If it's already under the target, we're done
              return resolve(blob);
            }
            // If it's too large, start iterative compression
            const compressLoop = async () => {
              for (let quality = 0.96; quality > 0.1; quality -= 0.02) {
                const compressedBlob: Blob = await new Promise((res) => {
                  canvas.toBlob(
                    (b) => res(b as Blob),
                    'image/jpeg',
                    quality
                  );
                });
                if (compressedBlob.size <= targetSizeInBytes) {
                  return resolve(compressedBlob);
                }
              }
              // If loop finishes, return the last (smallest) blob
              const lastBlob: Blob = await new Promise((res) => {
                canvas.toBlob((b) => res(b as Blob), 'image/jpeg', 0.1);
              });
              resolve(lastBlob);
            };
            compressLoop();
          },
          'image/jpeg',
          0.98
        );
      };
    };
    reader.onerror = (error) => reject(error);
  });
};