import { supabase } from '@/integrations/supabase/client';

interface SaveBatchParams {
  userId: string;
  batchName: string;
  transparentImages: Array<{ name: string; data: string }>;
  aiEnhancedImages?: Array<{ name: string; data: string }>;
  finalImages: Array<{ name: string; data: string }>;
}

/**
 * Save a batch of images to the library with Cloudinary support
 */
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
        thumbnail_url: null
      })
      .select()
      .single();

    if (batchError) throw batchError;

    const batchId = batch.id;
    let thumbnailPath: string | null = null;

    // Helper function to upload an image and create database record
    const uploadImage = async (
      imageData: { name: string; data: string },
      type: 'transparent' | 'ai-enhanced' | 'final',
      sortOrder: number
    ) => {
      console.log(`Uploading ${type} image: ${imageData.name}`);
      
      // Check if this is a Cloudinary URL (final images from Cloudinary rendering)
      const isCloudinaryUrl = imageData.data.startsWith('https://res.cloudinary.com');
      
      let publicUrl: string;
      let filePath: string;
      let dimensions = { width: 0, height: 0 };
      let fileSize = 0;
      let cloudinaryPublicId: string | null = null;
      
      if (isCloudinaryUrl) {
        // For Cloudinary URLs, extract public_id and store URL directly
        console.log('✓ Detected Cloudinary URL, storing reference');
        publicUrl = imageData.data;
        filePath = imageData.data; // Store full URL as path for Cloudinary images
        
        // Extract public_id from Cloudinary URL if possible
        const urlMatch = imageData.data.match(/\/v\d+\/(.+)\./);
        if (urlMatch) {
          cloudinaryPublicId = urlMatch[1];
        }
        
        // Get dimensions from the image
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = imageData.data;
        });
        dimensions = { width: img.naturalWidth, height: img.naturalHeight };
        
      } else {
        // For data URLs, upload to Supabase storage
        const response = await fetch(imageData.data);
        const blob = await response.blob();
        
        // Get dimensions
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = imageData.data;
        });
        
        dimensions = { width: img.naturalWidth, height: img.naturalHeight };
        fileSize = blob.size;
        
        // Generate unique filename
        const fileExt = imageData.data.match(/data:image\/(.*?);/)?.[1] || 'png';
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        filePath = `${userId}/${batchId}/${type}/${fileName}`;
        
        // Upload to storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('project-images')
          .upload(filePath, blob, {
            contentType: `image/${fileExt}`,
            upsert: false
          });
        
        if (uploadError) {
          console.error(`Upload error for ${imageData.name}:`, uploadError);
          throw uploadError;
        }
        
        console.log(`✓ Uploaded to storage: ${filePath}`);
        
        // Get public URL
        const { data: { publicUrl: storageUrl } } = supabase.storage
          .from('project-images')
          .getPublicUrl(filePath);
        
        publicUrl = storageUrl;
      }
      
      // Insert into batch_images table
      const { error: dbError } = await supabase
        .from('batch_images')
        .insert({
          batch_id: batchId,
          name: imageData.name,
          storage_path: filePath,
          image_type: type,
          file_size: fileSize,
          dimensions,
          sort_order: sortOrder,
          width: dimensions.width,
          height: dimensions.height,
          cloudinary_public_id: cloudinaryPublicId
        });
      
      if (dbError) {
        console.error(`Database insert error for ${imageData.name}:`, dbError);
        throw dbError;
      }
      
      console.log(`✓ Created database record for: ${imageData.name}`);
      
      return { publicUrl, filePath };
    };

    // Upload all transparent images
    for (let i = 0; i < transparentImages.length; i++) {
      await uploadImage(transparentImages[i], 'transparent', i);
    }

    // Upload all AI enhanced images
    for (let i = 0; i < aiEnhancedImages.length; i++) {
      await uploadImage(aiEnhancedImages[i], 'ai-enhanced', i + 100);
    }

    // Upload all final images and set first as thumbnail
    for (let i = 0; i < finalImages.length; i++) {
      const { filePath } = await uploadImage(finalImages[i], 'final', i + 200);
      
      if (i === 0 && !thumbnailPath) {
        thumbnailPath = filePath;
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
      (images || []).map(async (image) => {
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
