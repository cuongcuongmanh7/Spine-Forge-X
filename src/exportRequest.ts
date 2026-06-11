import type { MergedConfig } from './config';

/**
 * Resolve the Unity destination for a session using the `linkedProject` output policy:
 * look up the saved LinkedProject by id, then the chosen type by sourceName. Returns the
 * unityRoot (becomes the backend `outputPath`) and the destName (becomes `linkedDestType`),
 * or null when the project/type selection is incomplete.
 */
export function resolveLinkedTarget(cfg: MergedConfig): { unityRoot: string; destName: string } | null {
  const project = cfg.linkedProjects.find((p) => p.id === cfg.linkedProjectId);
  if (!project) return null;
  const type = project.types.find((t) => t.sourceName === cfg.linkedTypeName);
  if (!type) return null;
  return { unityRoot: project.unityRoot, destName: type.destName };
}

/** Build the Tauri `start_batch_export` request payload from a merged config + file list. */
export function buildExportRequestFrom(cfg: MergedConfig, sessionFiles: string[]) {
  // For the linkedProject policy the backend output root is the Unity root, and the
  // destination type folder is passed separately so resolve_output_dir can route into it.
  const linked = cfg.outputPolicy === 'linkedProject' ? resolveLinkedTarget(cfg) : null;
  return {
    spinePath: cfg.spinePath,
    inputRoot: cfg.inputPath,
    files: sessionFiles,
    outputPath: linked ? linked.unityRoot : cfg.outputPath,
    linkedDestType: linked ? linked.destName : '',
    outputPolicy: cfg.outputPolicy,
    targetVersion: cfg.targetVersion,
    exportMode: cfg.exportMode,
    fallbackMode: cfg.fallbackMode,
    globalJsonPath: cfg.globalJsonPath || null,
    builtInExport: cfg.builtInExport,
    generatedFormat: cfg.generatedFormat,
    generatedSkeletonExtension: cfg.generatedSkeletonExtension,
    generatedPackAtlas: cfg.generatedPackAtlas,
    generatedMaxWidth: cfg.generatedMaxWidth,
    generatedMaxHeight: cfg.generatedMaxHeight,
    generatedPremultiplyAlpha: cfg.generatedPremultiplyAlpha,
    generatedPot: cfg.generatedPot,
    generatedPaddingX: cfg.generatedPaddingX,
    generatedPaddingY: cfg.generatedPaddingY,
    generatedPrettyPrint: cfg.generatedPrettyPrint,
    generatedNonessential: cfg.generatedNonessential,
    generatedStripWhitespaceX: cfg.generatedStripWhitespaceX,
    generatedStripWhitespaceY: cfg.generatedStripWhitespaceY,
    generatedRotation: cfg.generatedRotation,
    generatedAlias: cfg.generatedAlias,
    generatedIgnoreBlankImages: cfg.generatedIgnoreBlankImages,
    generatedAlphaThreshold: cfg.generatedAlphaThreshold,
    generatedMinWidth: cfg.generatedMinWidth,
    generatedMinHeight: cfg.generatedMinHeight,
    generatedMultipleOfFour: cfg.generatedMultipleOfFour,
    generatedSquare: cfg.generatedSquare,
    generatedOutputFormat: cfg.generatedOutputFormat,
    generatedJpegQuality: cfg.generatedJpegQuality,
    generatedBleed: cfg.generatedBleed,
    generatedBleedIterations: cfg.generatedBleedIterations,
    generatedEdgePadding: cfg.generatedEdgePadding,
    generatedDuplicatePadding: cfg.generatedDuplicatePadding,
    generatedFilterMin: cfg.generatedFilterMin,
    generatedFilterMag: cfg.generatedFilterMag,
    generatedWrapX: cfg.generatedWrapX,
    generatedWrapY: cfg.generatedWrapY,
    generatedTextureFormat: cfg.generatedTextureFormat,
    generatedAtlasExtension: cfg.generatedAtlasExtension,
    generatedCombineSubdirectories: cfg.generatedCombineSubdirectories,
    generatedFlattenPaths: cfg.generatedFlattenPaths,
    generatedUseIndexes: cfg.generatedUseIndexes,
    generatedFast: cfg.generatedFast,
    generatedLimitMemory: cfg.generatedLimitMemory,
    generatedPacking: cfg.generatedPacking,
    generatedPackSource: cfg.generatedPackSource,
    generatedPackTarget: cfg.generatedPackTarget,
    generatedWarnings: cfg.generatedWarnings,
    generatedForceAll: cfg.generatedForceAll,
    clean: cfg.clean,
    parallelJobs: cfg.parallelJobs,
    maxMemory: cfg.maxMemory,
    timeoutSeconds: cfg.timeoutSeconds,
    preserveRelativePaths: cfg.preserveRelativePaths,
    cleanFolderName: cfg.cleanFolderName,
    unicodeWorkaround: cfg.unicodeWorkaround
  };
}
