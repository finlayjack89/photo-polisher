import { supabase } from '@/integrations/supabase/client';

interface SaveBatchParams {
  userId: string;
  batchName: string;
  transparentImages: Array<{ name: string; data: string }>;
  aiEnhancedImages?: Array<{ name: string; data: string }>;
  finalImages: Array<{ name: string; data: string }>;
}

export const saveBatchToLibrary = async ({
  userId,
  batchName,
  transparentImages,
  aiEnhancedImages = [],
  finalImages
}: SaveBatchParams): Promise<{ success: boolean; batchId?: string; error?: string }> => {
  try {
    // Create batch record
    const { data: batch, error: batchError } = await supabase
      .from('project_batches')
      .insert({
        user_id: userId,
        name: batchName,
        thumbnail_url: null // Will update after uploading first final image
      })
      .select()
      .single();

    if (batchError) throw batchError;

    const batchId = batch.id;
    let thumbnailPath: string | null = null;

    // Helper to upload image and create record
    const uploadImage = async (
      imageData: string,
      name: string,
      type: 'transparent' | 'ai_enhanced' | 'final',
      sortOrder: number
    ) => {
      // Convert base64 to blob
      const base64Data = imageData.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteArrays = [];
      
      for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
          byteNumbers[i] = slice.charCodeAt(i);
        }
        byteArrays.push(new Uint8Array(byteNumbers));
      }
      
      const blob = new Blob(byteArrays, { type: 'image/png' });

      // Get image dimensions
      const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.src = imageData;
      });

      // Upload to storage
      const fileName = `${Date.now()}_${name}`;
      const storagePath = `${userId}/${batchId}/${type}/${fileName}`;
      
      const { error: uploadError } = await supabase.storage
        .from('project-images')
        .upload(storagePath, blob, {
          contentType: 'image/png',
          upsert: false
        });

      if (uploadError) throw uploadError;

      // Create database record
      const { error: recordError } = await supabase
        .from('batch_images')
        .insert({
          batch_id: batchId,
          name: name,
          image_type: type,
          storage_path: storagePath,
          file_size: blob.size,
          dimensions: dimensions,
          sort_order: sortOrder
        });

      if (recordError) throw recordError;

      return storagePath;
    };

    // Upload all transparent images
    for (let i = 0; i < transparentImages.length; i++) {
      await uploadImage(transparentImages[i].data, transparentImages[i].name, 'transparent', i);
    }

    // Upload all AI enhanced images
    for (let i = 0; i < aiEnhancedImages.length; i++) {
      await uploadImage(aiEnhancedImages[i].data, aiEnhancedImages[i].name, 'ai_enhanced', i + 100);
    }

    // Upload all final images and set first as thumbnail
    for (let i = 0; i < finalImages.length; i++) {
      const path = await uploadImage(finalImages[i].data, finalImages[i].name, 'final', i + 200);
      
      if (i === 0 && !thumbnailPath) {
        thumbnailPath = path;
      }
    }

    // Update batch with thumbnail
    if (thumbnailPath) {
      await supabase
        .from('project_batches')
        .update({ thumbnail_url: thumbnailPath })
        .eq('id', batchId);
    }

    return { success: true, batchId };
  } catch (error) {
    console.error('Error saving batch to library:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
};

export const loadTransparentImagesFromBatch = async (
  batchId: string
): Promise<Array<{ name: string; data: string }> | null> => {
  try {
    // Get transparent images from batch
    const { data: images, error: imagesError } = await supabase
      .from('batch_images')
      .select('*')
      .eq('batch_id', batchId)
      .eq('image_type', 'transparent')
      .order('sort_order');

    if (imagesError) throw imagesError;

    // Download each image
    const imageData = await Promise.all(
      images.map(async (image) => {
        const { data: blob, error: downloadError } = await supabase.storage
          .from('project-images')
          .download(image.storage_path);

        if (downloadError) throw downloadError;

        // Convert blob to base64
        return new Promise<{ name: string; data: string }>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve({
              name: image.name,
              data: reader.result as string
            });
          };
          reader.readAsDataURL(blob);
        });
      })
    );

    return imageData;
  } catch (error) {
    console.error('Error loading transparent images:', error);
    return null;
  }
};
