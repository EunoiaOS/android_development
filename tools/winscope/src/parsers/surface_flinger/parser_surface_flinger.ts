/*
 * Copyright (C) 2022 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {assertDefined} from 'common/assert_utils';
import {Timestamp, TimestampType} from 'common/time';
import {NO_TIMEZONE_OFFSET_FACTORY} from 'common/timestamp_factory';
import {AbstractParser} from 'parsers/abstract_parser';
import {AddDefaults} from 'parsers/operations/add_defaults';
import {SetFormatters} from 'parsers/operations/set_formatters';
import {TranslateIntDef} from 'parsers/operations/translate_intdef';
import {TamperedMessageType} from 'parsers/tampered_message_type';
import root from 'protos/surfaceflinger/udc/json';
import {android} from 'protos/surfaceflinger/udc/static';
import {
  CustomQueryParserResultTypeMap,
  CustomQueryType,
  VisitableParserCustomQuery,
} from 'trace/custom_query';
import {EntriesRange} from 'trace/trace';
import {TraceType} from 'trace/trace_type';
import {EnumFormatter, LAYER_ID_FORMATTER} from 'trace/tree_node/formatters';
import {HierarchyTreeNode} from 'trace/tree_node/hierarchy_tree_node';
import {PropertiesProvider} from 'trace/tree_node/properties_provider';
import {PropertiesProviderBuilder} from 'trace/tree_node/properties_provider_builder';
import {RectsComputation} from './computations/rects_computation';
import {VisibilityPropertiesComputation} from './computations/visibility_properties_computation';
import {ZOrderPathsComputation} from './computations/z_order_paths_computation';
import {HierarchyTreeBuilderSf} from './hierarchy_tree_builder_sf';
import {ParserSfUtils} from './parser_surface_flinger_utils';

class ParserSurfaceFlinger extends AbstractParser<HierarchyTreeNode> {
  private static readonly MAGIC_NUMBER = [
    0x09, 0x4c, 0x59, 0x52, 0x54, 0x52, 0x41, 0x43, 0x45,
  ]; // .LYRTRACE
  private static readonly CUSTOM_FORMATTERS = new Map([
    ['cropLayerId', LAYER_ID_FORMATTER],
    ['zOrderRelativeOf', LAYER_ID_FORMATTER],
    [
      'hwcCompositionType',
      new EnumFormatter(android.surfaceflinger.HwcCompositionType),
    ],
  ]);

  private static readonly LayersTraceFileProto = TamperedMessageType.tamper(
    root.lookupType('android.surfaceflinger.LayersTraceFileProto'),
  );
  private static readonly entryField =
    ParserSurfaceFlinger.LayersTraceFileProto.fields['entry'];
  private static readonly layerField = assertDefined(
    ParserSurfaceFlinger.entryField.tamperedMessageType?.fields['layers']
      .tamperedMessageType,
  ).fields['layers'];

  private static readonly Operations = {
    SetFormattersLayer: new SetFormatters(
      ParserSurfaceFlinger.layerField,
      ParserSurfaceFlinger.CUSTOM_FORMATTERS,
    ),
    TranslateIntDefLayer: new TranslateIntDef(ParserSurfaceFlinger.layerField),
    AddDefaultsLayerEager: new AddDefaults(
      ParserSurfaceFlinger.layerField,
      ParserSfUtils.EAGER_PROPERTIES,
    ),
    AddDefaultsLayerLazy: new AddDefaults(
      ParserSurfaceFlinger.layerField,
      undefined,
      ParserSfUtils.EAGER_PROPERTIES.concat(ParserSfUtils.DENYLIST_PROPERTIES),
    ),
    SetFormattersEntry: new SetFormatters(
      ParserSurfaceFlinger.entryField,
      ParserSurfaceFlinger.CUSTOM_FORMATTERS,
    ),
    TranslateIntDefEntry: new TranslateIntDef(ParserSurfaceFlinger.entryField),
    AddDefaultsEntryEager: new AddDefaults(ParserSurfaceFlinger.entryField, [
      'displays',
    ]),
    AddDefaultsEntryLazy: new AddDefaults(
      ParserSurfaceFlinger.entryField,
      undefined,
      ParserSfUtils.DENYLIST_PROPERTIES,
    ),
  };

  private realToElapsedTimeOffsetNs: undefined | bigint;

  override getTraceType(): TraceType {
    return TraceType.SURFACE_FLINGER;
  }

  override getMagicNumber(): number[] {
    return ParserSurfaceFlinger.MAGIC_NUMBER;
  }

  override decodeTrace(
    buffer: Uint8Array,
  ): android.surfaceflinger.ILayersTraceProto[] {
    const decoded = ParserSurfaceFlinger.LayersTraceFileProto.decode(
      buffer,
    ) as android.surfaceflinger.ILayersTraceFileProto;
    const timeOffset = BigInt(
      decoded.realToElapsedTimeOffsetNanos?.toString() ?? '0',
    );
    this.realToElapsedTimeOffsetNs = timeOffset !== 0n ? timeOffset : undefined;
    return decoded.entry ?? [];
  }

  override getTimestamp(
    type: TimestampType,
    entry: android.surfaceflinger.ILayersTraceProto,
  ): undefined | Timestamp {
    const isDump = !Object.prototype.hasOwnProperty.call(
      entry,
      'elapsedRealtimeNanos',
    );
    if (
      isDump &&
      NO_TIMEZONE_OFFSET_FACTORY.canMakeTimestampFromType(
        type,
        this.realToElapsedTimeOffsetNs,
      )
    ) {
      return NO_TIMEZONE_OFFSET_FACTORY.makeTimestampFromType(type, 0n, 0n);
    }

    if (!isDump) {
      const elapsedRealtimeNanos = BigInt(
        assertDefined(entry.elapsedRealtimeNanos).toString(),
      );
      if (
        this.timestampFactory.canMakeTimestampFromType(
          type,
          this.realToElapsedTimeOffsetNs,
        )
      ) {
        return this.timestampFactory.makeTimestampFromType(
          type,
          elapsedRealtimeNanos,
          this.realToElapsedTimeOffsetNs,
        );
      }
    }

    return undefined;
  }

  override processDecodedEntry(
    index: number,
    timestampType: TimestampType,
    entry: android.surfaceflinger.ILayersTraceProto,
  ): HierarchyTreeNode {
    return this.makeHierarchyTree(entry);
  }

  override customQuery<Q extends CustomQueryType>(
    type: Q,
    entriesRange: EntriesRange,
  ): Promise<CustomQueryParserResultTypeMap[Q]> {
    return new VisitableParserCustomQuery(type)
      .visit(CustomQueryType.VSYNCID, () => {
        const result = this.decodedEntries
          .slice(entriesRange.start, entriesRange.end)
          .map((entry) => {
            return BigInt(entry.vsyncId.toString()); // convert Long to bigint
          });
        return Promise.resolve(result);
      })
      .visit(CustomQueryType.SF_LAYERS_ID_AND_NAME, () => {
        const result: Array<{id: number; name: string}> = [];
        this.decodedEntries
          .slice(entriesRange.start, entriesRange.end)
          .forEach((entry: android.surfaceflinger.ILayersTraceProto) => {
            entry.layers?.layers?.forEach(
              (layer: android.surfaceflinger.ILayerProto) => {
                result.push({
                  id: assertDefined(layer.id),
                  name: assertDefined(layer.name),
                });
              },
            );
          });
        return Promise.resolve(result);
      })
      .getResult();
  }

  private makeHierarchyTree(
    entryProto: android.surfaceflinger.ILayersTraceProto,
  ): HierarchyTreeNode {
    const excludesCompositionState =
      entryProto?.excludesCompositionState ?? false;
    const addExcludesCompositionState = excludesCompositionState
      ? ParserSfUtils.OPERATIONS.AddExcludesCompositionStateTrue
      : ParserSfUtils.OPERATIONS.AddExcludesCompositionStateFalse;

    const processed = new Map<number, number>();

    const layers: PropertiesProvider[] = assertDefined(
      entryProto.layers?.layers,
    ).map((layer: android.surfaceflinger.ILayerProto) => {
      const duplicateCount = processed.get(assertDefined(layer.id)) ?? 0;
      processed.set(assertDefined(layer.id), duplicateCount + 1);
      const eagerProperties = ParserSfUtils.makeEagerPropertiesTree(
        layer,
        duplicateCount,
      );
      const lazyPropertiesStrategy =
        ParserSfUtils.makeLayerLazyPropertiesStrategy(layer, duplicateCount);

      const layerProps = new PropertiesProviderBuilder()
        .setEagerProperties(eagerProperties)
        .setLazyPropertiesStrategy(lazyPropertiesStrategy)
        .setCommonOperations([
          ParserSurfaceFlinger.Operations.SetFormattersLayer,
          ParserSurfaceFlinger.Operations.TranslateIntDefLayer,
        ])
        .setEagerOperations([
          ParserSurfaceFlinger.Operations.AddDefaultsLayerEager,
          ParserSfUtils.OPERATIONS.AddCompositionType,
          ParserSfUtils.OPERATIONS.UpdateTransforms,
          ParserSfUtils.OPERATIONS.AddVerboseFlags,
          addExcludesCompositionState,
        ])
        .setLazyOperations([
          ParserSurfaceFlinger.Operations.AddDefaultsLayerLazy,
        ])
        .build();
      return layerProps;
    });

    const entry = new PropertiesProviderBuilder()
      .setEagerProperties(
        ParserSfUtils.makeEntryEagerPropertiesTree(entryProto),
      )
      .setLazyPropertiesStrategy(
        ParserSfUtils.makeEntryLazyPropertiesStrategy(entryProto),
      )
      .setCommonOperations([
        ParserSurfaceFlinger.Operations.SetFormattersEntry,
        ParserSurfaceFlinger.Operations.TranslateIntDefEntry,
      ])
      .setEagerOperations([
        ParserSurfaceFlinger.Operations.AddDefaultsEntryEager,
      ])
      .setLazyOperations([
        ParserSurfaceFlinger.Operations.AddDefaultsEntryLazy,
        ParserSfUtils.OPERATIONS.AddDisplayProperties,
      ])
      .build();

    return new HierarchyTreeBuilderSf()
      .setRoot(entry)
      .setChildren(layers)
      .setComputations([
        new ZOrderPathsComputation(),
        new VisibilityPropertiesComputation(),
        new RectsComputation(),
      ])
      .build();
  }
}

export {ParserSurfaceFlinger};
