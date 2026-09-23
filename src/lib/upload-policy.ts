/**
 * Kept below the 4.5 MB serverless request ceiling. The limit is applied to
 * the total image bytes of one independently reviewed content item.
 */
export const MAX_REVIEW_IMAGE_BYTES = 3_500_000;
export const MAX_REVIEW_IMAGE_LABEL = "3.5MB";

export function imageBytes(files: Array<{ size: number }>) {
  return files.reduce((total, file) => total + file.size, 0);
}
