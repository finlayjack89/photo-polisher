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

        // --- THIS IS THE CORRECTED PART ---
        const MAX_DIMENSION = 2048; // Set the correct, higher resolution target
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

        // First, get a high-quality blob from the resized canvas
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              return reject(new Error('Canvas toBlob returned null'));
            }

            // If the resized image is already under the target, we're done.
            if (blob.size <= targetSizeInBytes) {
              return resolve(blob);
            }

            // If it's still too large, start the iterative compression loop.
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
              // If the loop finishes, return the smallest version.
              const lastBlob: Blob = await new Promise((res) => {
                  canvas.toBlob((b) => res(b as Blob), 'image/jpeg', 0.1);
              });
              resolve(lastBlob);
            };

            compressLoop();
          },
          'image/jpeg',
          0.98 // Start with very high quality
        );
      };
      img.onerror = (error) => reject(new Error('Failed to load image: ' + error));
    };
    reader.onerror = (error) => reject(error);
  });
};