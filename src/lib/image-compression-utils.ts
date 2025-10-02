import imageCompression from 'browser-image-compression';

/**
 * Compress image data URL to stay under Cloudinary's 10MB upload limit
 */
export const compressImageForCloudinary = async (
  dataUrl: string,
  maxSizeMB: number = 8
): Promise<string> => {
  try {
    console.log('🗜️ Compressing image for Cloudinary upload...');
    
    // Convert data URL to Blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    
    const originalSizeMB = blob.size / 1024 / 1024;
    console.log(`Original size: ${originalSizeMB.toFixed(2)}MB`);
    
    // If already under limit, return as-is
    if (originalSizeMB <= maxSizeMB) {
      console.log('✅ Image already under size limit');
      return dataUrl;
    }
    
    // Compress the image
    const options = {
      maxSizeMB,
      maxWidthOrHeight: 4096,
      useWebWorker: true,
      fileType: 'image/png',
      preserveExif: false,
    };
    
    const compressedBlob = await imageCompression(blob as File, options);
    const compressedSizeMB = compressedBlob.size / 1024 / 1024;
    
    console.log(`✅ Compressed to: ${compressedSizeMB.toFixed(2)}MB (${((1 - compressedSizeMB / originalSizeMB) * 100).toFixed(1)}% reduction)`);
    
    // Convert back to data URL
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(compressedBlob);
    });
  } catch (error) {
    console.error('Error compressing image:', error);
    // Return original if compression fails
    return dataUrl;
  }
};
