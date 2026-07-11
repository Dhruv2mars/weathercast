import type {
  RadarFrameInput,
  RainObservationInput,
  SourceAssetInput,
} from './archive';

export type StoredSourceAsset = { id: string; sha256: string };

export interface PrecisionIngestionStore {
  archiveSourceAsset(input: SourceAssetInput): StoredSourceAsset | Promise<StoredSourceAsset>;
  archiveRadarFrame(input: {
    asset: SourceAssetInput;
    frame: Omit<RadarFrameInput, 'sourceAssetId'>;
  }): { asset: StoredSourceAsset; frameId: string } | Promise<{ asset: StoredSourceAsset; frameId: string }>;
  archiveObservationBatch(input: {
    asset: SourceAssetInput;
    observations: RainObservationInput[];
  }): { asset: StoredSourceAsset; observationsAccepted: number }
    | Promise<{ asset: StoredSourceAsset; observationsAccepted: number }>;
  close(): void | Promise<void>;
}
