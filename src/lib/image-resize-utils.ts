/**
 * Utility functions for resizing images to prevent Edge Function memory issues
 */

/**
 * Resize an image to fit within maximum dimensions while maintaining aspect ratio
 */
export const resizeImageFile = (file: File, maxWidth: number, maxHeight: number, quality: number = 0.8): Promise<File> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Could not get canvas context'));

      // Calculate new dimensions while maintaining aspect ratio
      let { width, height } = calculateResizedDimensions(
        img.naturalWidth, 
        img.naturalHeight, 
        maxWidth, 
        maxHeight
      );

      canvas.width = width;
      canvas.height = height;

      // Draw resized image
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to blob and then to File
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Failed to create blob'));
        
        const resizedFile = new File([blob], file.name, {
          type: 'image/jpeg', // Always convert to JPEG for smaller size
          lastModified: Date.now()
        });
        
        resolve(resizedFile);
      }, 'image/jpeg', quality);
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
};

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