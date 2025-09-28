// This function gets the natural dimensions of an image file. It is needed by BackdropPositioning.tsx.
import { FileWithOriginalSize } from '@/components/UploadZone'; // Adjust path if needed

export const processAndCompressImage = (file: File | Blob): Promise<Blob> => {
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

        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height *= MAX_DIMENSION / width;
            width = MAX_DIMENSION;
          } else {
            width *= MAX_DIMENSION / height;
            height = MAX_DIMENSION;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        const targetSizeInBytes = 5 * 1024 * 1024;

        // This function finds the highest quality under 5MB
        const findOptimalCompression = async () => {
          for (let quality = 1.0; quality >= 0.1; quality -= 0.02) {
            const compressedBlob: Blob = await new Promise((res) => {
              canvas.toBlob((b) => res(b as Blob), 'image/jpeg', quality);
            });

            if (compressedBlob.size <= targetSizeInBytes) {
              console.log(`Optimal quality found: ${Math.round(quality * 100)}% -> ${(compressedBlob.size / (1024 * 1024)).toFixed(2)}MB`);
              return resolve(compressedBlob);
            }
          }
          
          // Fallback if even lowest quality is too large
          const lastBlob: Blob = await new Promise((res) => {
            canvas.toBlob((b) => res(b as Blob), 'image/jpeg', 0.1);
          });
          resolve(lastBlob);
        };

        findOptimalCompression();
      };
      img.onerror = (error) => reject(new Error('Failed to load image: ' + error.toString()));
    };
    reader.onerror = (error) => reject(error);
  });
};

export const getImageDimensions = (file: File | Blob): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};