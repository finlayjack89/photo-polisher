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
 * Ensures maximum quality while staying under 5MB (or 4.5MB minimum for files originally over 5MB)
 */
export const processAndCompressImage = (file: File, originalFileSize?: number): Promise<Blob> => {
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
        
        // Determine compression strategy based on original file size
        const originalSize = originalFileSize || file.size;
        const wasOriginallyLarge = originalSize > 5 * 1024 * 1024;
        
        // For files originally over 5MB, aim to keep them between 4.5-5MB
        // For smaller files, keep them under 5MB
        const maxTargetSize = 5 * 1024 * 1024;  // 5MB max
        const minTargetSize = wasOriginallyLarge ? 4.5 * 1024 * 1024 : 0;  // 4.5MB min for large files
        
        // First, attempt to get a high-quality blob
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              return reject(new Error('Canvas toBlob returned null'));
            }
            
            // If it's already in the target range, we're done
            if (blob.size <= maxTargetSize && blob.size >= minTargetSize) {
              return resolve(blob);
            }
            
            // If it's under the minimum for large files, return it anyway (better quality)
            if (wasOriginallyLarge && blob.size < minTargetSize) {
              return resolve(blob);
            }
            
            // Only compress if it's over the max target
            if (blob.size <= maxTargetSize) {
              return resolve(blob);
            }
            
            // If it's too large, start gentle compression
            const compressLoop = async () => {
              for (let quality = 0.95; quality > 0.1; quality -= 0.05) {
                const compressedBlob: Blob = await new Promise((res) => {
                  canvas.toBlob(
                    (b) => res(b as Blob),
                    'image/jpeg',
                    quality
                  );
                });
                
                // Stop when we're in the target range
                if (compressedBlob.size <= maxTargetSize && compressedBlob.size >= minTargetSize) {
                  return resolve(compressedBlob);
                }
                
                // For large files, don't compress below 4.5MB
                if (wasOriginallyLarge && compressedBlob.size <= minTargetSize) {
                  return resolve(compressedBlob);
                }
                
                // For smaller files, stop when under 5MB
                if (!wasOriginallyLarge && compressedBlob.size <= maxTargetSize) {
                  return resolve(compressedBlob);
                }
              }
              
              // If loop finishes, return the last blob
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