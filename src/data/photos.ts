export interface PhotoSrc {
  thumb: string;
  medium: string;
  large: string;
  full: string;
}

export interface Photo {
  id: string;
  album: string;
  createDate: string;
  width: number;
  height: number;
  aspectRatio: number;
  blurDataURL: string;
  src: PhotoSrc;
}
