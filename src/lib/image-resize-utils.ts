// This function gets the natural dimensions of an image file.
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

// This function resizes to 2048px and then iteratively compresses if over 5MB.
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

        const targetSizeInBytes = 5 * 1024 * 1024; // 5MB Target

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              return reject(new Error('Canvas toBlob returned null'));
            }

            if (blob.size <= targetSizeInBytes) {
              return resolve(blob);
            }

            const compressLoop = async () => {
              for (let quality = 0.96; quality >= 0.1; quality -= 0.02) {
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
      img.onerror = (error) => reject(new Error('Failed to load image: ' + error));
    };
    reader.onerror = (error) => reject(error);
  });
};