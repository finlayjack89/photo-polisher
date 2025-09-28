export const processAndCompressImage = (file: File): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const targetSizeInBytes = 5 * 1024 * 1024; // 5MB Target

    // If the file is already under the target size, return it immediately without changes.
    if (file.size <= targetSizeInBytes) {
      return resolve(file);
    }

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

        // Use the image's original dimensions. No forced resizing.
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0, img.width, img.height);

        // Start the iterative compression loop.
        const compressLoop = async () => {
          for (let quality = 0.98; quality >= 0.1; quality -= 0.02) {
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
          
          // If the loop finishes, return the smallest version possible.
          const lastBlob: Blob = await new Promise((res) => {
              canvas.toBlob((b) => res(b as Blob), 'image/jpeg', 0.1);
          });
          resolve(lastBlob);
        };

        compressLoop();
      };
      img.onerror = (error) => reject(new Error('Failed to load image: ' + error));
    };
    reader.onerror = (error) => reject(error);
  });
};