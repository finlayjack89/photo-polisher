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
 * Process and compress images only if they exceed 5MB
 * Images under 5MB are returned as-is without any processing
 * Images over 5MB are resized to max 2048x2048 and compressed to 4.5-5MB range
 */
export const processAndCompressImage = (file: File, originalFileSize?: number): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const originalSize = originalFileSize || file.size;
    const SIZE_5MB = 5 * 1024 * 1024;
    const SIZE_4_5MB = 4.5 * 1024 * 1024;
    
    // If file is under 5MB, return as-is without any processing
    if (originalSize <= SIZE_5MB) {
      return resolve(file);
    }
    
    // Only process files over 5MB
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
        
        // Resize to maximum 2048x2048 while preserving aspect ratio
        const MAX_DIMENSION = 2048;
        let { width, height } = img;
        
        // Calculate new dimensions preserving aspect ratio
        if (width > height) {
          if (width > MAX_DIMENSION) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
          }
        } else {
          if (height > MAX_DIMENSION) {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        
        // Start with high quality and iteratively compress by 2% until 4.5-5MB range
        const compressLoop = async () => {
          // Start with 98% quality
          for (let quality = 0.98; quality > 0.1; quality -= 0.02) {
            const compressedBlob: Blob = await new Promise((res) => {
              canvas.toBlob(
                (b) => res(b as Blob),
                'image/jpeg',
                quality
              );
            });
            
            // Check if we're in the target range (4.5MB - 5MB)
            if (compressedBlob.size >= SIZE_4_5MB && compressedBlob.size <= SIZE_5MB) {
              return resolve(compressedBlob);
            }
            
            // If we've compressed below 4.5MB, use the previous iteration
            if (compressedBlob.size < SIZE_4_5MB) {
              // Go back to previous quality level (2% higher)
              const finalQuality = Math.min(quality + 0.02, 0.98);
              const finalBlob: Blob = await new Promise((res) => {
                canvas.toBlob((b) => res(b as Blob), 'image/jpeg', finalQuality);
              });
              return resolve(finalBlob);
            }
          }
          
          // If we've exhausted all quality levels, return the last blob
          const lastBlob: Blob = await new Promise((res) => {
            canvas.toBlob((b) => res(b as Blob), 'image/jpeg', 0.1);
          });
          resolve(lastBlob);
        };
        
        compressLoop();
      };
    };
    reader.onerror = (error) => reject(error);
  });
};