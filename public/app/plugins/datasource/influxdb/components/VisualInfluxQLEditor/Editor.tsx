import React from 'react';
import { InfluxQuery, InfluxQueryTag, InfluxQueryPart } from '../../types';
import { SelectableValue } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import InfluxDatasource from '../../datasource';
import { FromSection } from './FromSection';
import { TagsSection } from './TagsSection';
import { PartListSection } from './PartListSection';
import { OrderByTimeSection } from './OrderByTimeSection';
import { InputSection } from './InputSection';
import InfluxQueryModel from '../../influx_query_model';
import { unwrap } from './unwrap';
import {
  getAllMeasurements,
  getAllPolicies,
  getFieldKeysForMeasurement,
  getTagKeysForMeasurementAndTags,
  getTagValues,
} from '../../influxQLMetadataQuery';
import queryPart from '../../query_part';
import {
  normalizeQuery,
  addNewSelectPart,
  removeSelectPart,
  addNewGroupByPart,
  removeGroupByPart,
} from '../queryUtils';
import { QueryPartDef } from '../../../../../core/components/query_part/query_part';
import { FormatAsSection } from './FormatAsSection';
import { SectionLabel } from './SectionLabel';
import { SectionFill } from './SectionFill';
import { DEFAULT_RESULT_FORMAT } from '../constants';

type Props = {
  query: InfluxQuery;
  onChange: (query: InfluxQuery) => void;
  onRunQuery: () => void;
  datasource: InfluxDatasource;
};

type Categories = Record<string, QueryPartDef[]>;

function getTemplateVariableOptions() {
  return (
    getTemplateSrv()
      .getVariables()
      // we make them regex-params, i'm not 100% sure why.
      // probably because this way multi-value variables work ok too.
      .map((v) => `/^$${v.name}$/`)
  );
}

// helper function to make it easy to call this from the widget-render-code
function withTemplateVariableOptions(optionsPromise: Promise<string[]>): Promise<string[]> {
  return optionsPromise.then((options) => [...getTemplateVariableOptions(), ...options]);
}

function getNewSelectPartOptions(): SelectableValue[] {
  const categories: Categories = queryPart.getCategories();
  const options: SelectableValue[] = [];

  const keys = Object.keys(categories);
  keys.sort(); // to make sure they are alphabetically sorted

  keys.forEach((key) => {
    const children: SelectableValue[] = categories[key].map((x) => ({
      value: x.type,
      label: x.type,
    }));

    options.push({
      label: key,
      options: children,
    });
  });

  return options;
}

function getNewGroupByPartOptions(query: InfluxQuery): Array<SelectableValue<string>> {
  const queryCopy = { ...query }; // the query-model mutates the query
  const model = new InfluxQueryModel(queryCopy);
  const options: Array<SelectableValue<string>> = [];
  if (!model.hasFill()) {
    options.push({
      label: 'fill(null)',
      value: 'fill(null)',
    });
  }
  if (!model.hasGroupByTime()) {
    options.push({
      label: 'time($interval)',
      value: 'time($interval)',
    });
  }
  options.push({
    label: 'tag(tagName)',
    value: 'tag(tagName)',
  });
  return options;
}

type PartParams = Array<{
  value: string;
  options: (() => Promise<string[]>) | null;
}>;

type Part = {
  name: string;
  params: PartParams;
};

function getPartParams(part: InfluxQueryPart, dynamicParamOptions: Map<string, () => Promise<string[]>>): PartParams {
  // NOTE: the way the system is constructed,
  // there always can only be one possible dynamic-lookup
  // field. in case of select it is the field,
  // in case of group-by it is the tag
  const def = queryPart.create(part).def;

  // we switch the numbers to strings, it will work that way too,
  // and it makes the code simpler
  const paramValues = (part.params ?? []).map((p) => p.toString());

  if (paramValues.length !== def.params.length) {
    throw new Error('Invalid query-segment');
  }

  return paramValues.map((val, index) => {
    const defParam = def.params[index];
    if (defParam.dynamicLookup) {
      return {
        value: val,
        options: unwrap(dynamicParamOptions.get(`${def.type}_${index}`)),
      };
    }

    if (defParam.options != null) {
      return {
        value: val,
        options: () => Promise.resolve(defParam.options),
      };
    }

    return {
      value: val,
      options: null,
    };
  });
}

function makePartList(
  queryParts: InfluxQueryPart[],
  dynamicParamOptions: Map<string, () => Promise<string[]>>
): Part[] {
  return queryParts.map((qp) => {
    return {
      name: qp.type,
      params: getPartParams(qp, dynamicParamOptions),
    };
  });
}

const SectionWrap = ({ initialName, children }: { initialName: string; children: React.ReactNode }) => (
  <div className="gf-form-inline">
    <SectionLabel name={initialName} isInitial={true} />
    {children}
    <SectionFill />
  </div>
);

export const Editor = (props: Props): JSX.Element => {
  const query = normalizeQuery(props.query);
  const { datasource } = props;
  const onAppliedChange = (newQuery: InfluxQuery) => {
    props.onChange(newQuery);
    props.onRunQuery();
  };
  const handleFromSectionChange = (policy: string | undefined, measurement: string | undefined) => {
    onAppliedChange({
      ...query,
      policy,
      measurement,
    });
  };

  const handleTagsSectionChange = (tags: InfluxQueryTag[]) => {
    // we set empty-arrays to undefined
    onAppliedChange({
      ...query,
      tags: tags.length === 0 ? undefined : tags,
    });
  };

  const dynamicSelectPartOptions = new Map([
    ['field_0', () => getFieldKeysForMeasurement(unwrap(query.measurement), query.policy, datasource)],
  ]);
  const selectLists = (query.select ?? []).map((sel) => makePartList(sel, dynamicSelectPartOptions));

  const dynamicGroupByPartOptions = new Map([
    [
      'tag_0',
      () => getTagKeysForMeasurementAndTags(unwrap(query.measurement), query.policy, query.tags ?? [], datasource),
    ],
  ]);

  const groupByList = makePartList(query.groupBy ?? [], dynamicGroupByPartOptions);

  return (
    <div>
      <SectionWrap initialName="from">
        <FromSection
          policy={query.policy}
          measurement={query.measurement}
          getPolicyOptions={() => getAllPolicies(datasource)}
          getMeasurementOptions={() => withTemplateVariableOptions(getAllMeasurements(datasource))}
          onChange={handleFromSectionChange}
        />
        <SectionLabel name="where" />
        <TagsSection
          tags={query.tags ?? []}
          onChange={handleTagsSectionChange}
          getTagKeyOptions={() =>
            getTagKeysForMeasurementAndTags(unwrap(query.measurement), query.policy, query.tags ?? [], datasource)
          }
          getTagValueOptions={(key: string) =>
            withTemplateVariableOptions(getTagValues(key, unwrap(query.measurement), query.policy, datasource))
          }
        />
      </SectionWrap>
      {selectLists.map((sel, index) => (
        <SectionWrap key={index.toString()} initialName={index === 0 ? 'select' : ''}>
          <PartListSection
            key={index.toString()}
            parts={sel}
            newPartOptions={getNewSelectPartOptions()}
            onChange={(partIndex, newParams) => {
              const newSel = [...(query.select ?? [])];
              newSel[index] = [...newSel[index]];
              newSel[index][partIndex] = {
                ...newSel[index][partIndex],
                params: newParams,
              };
              onAppliedChange({ ...query, select: newSel });
            }}
            onAddNewPart={(type) => {
              onAppliedChange(addNewSelectPart(query, type, index));
            }}
            onRemovePart={(partIndex) => {
              onAppliedChange(removeSelectPart(query, partIndex, index));
            }}
          />
        </SectionWrap>
      ))}
      <SectionWrap initialName="group by">
        <PartListSection
          parts={groupByList}
          newPartOptions={getNewGroupByPartOptions(query)}
          onChange={(partIndex, newParams) => {
            const newGroupBy = [...(query.groupBy ?? [])];
            newGroupBy[partIndex] = {
              ...newGroupBy[partIndex],
              params: newParams,
            };
            onAppliedChange({ ...query, groupBy: newGroupBy });
          }}
          onAddNewPart={(type) => {
            onAppliedChange(addNewGroupByPart(query, type));
          }}
          onRemovePart={(partIndex) => {
            onAppliedChange(removeGroupByPart(query, partIndex));
          }}
        />
      </SectionWrap>
      <SectionWrap initialName="tz">
        <InputSection
          placeholder="(optional)"
          value={query.tz}
          onChange={(tz) => {
            onAppliedChange({ ...query, tz });
          }}
        />
        <SectionLabel name="order by time" />
        <OrderByTimeSection
          value={query.orderByTime === 'DESC' ? 'DESC' : 'ASC' /* FIXME: make this shared with influx_query_model */}
          onChange={(v) => {
            onAppliedChange({ ...query, orderByTime: v });
          }}
        />
      </SectionWrap>
      {/* query.fill is ignored in the query-editor, and it is deleted whenever
          query-editor changes. the influx_query_model still handles it, but the new
          approach seem to be to handle "fill" inside query.groupBy. so, if you
          have a panel where in the json you have query.fill, it will be appled,
          as long as you do not edit that query. */}
      <SectionWrap initialName="limit">
        <InputSection
          placeholder="(optional)"
          value={query.limit?.toString()}
          onChange={(limit) => {
            onAppliedChange({ ...query, limit });
          }}
        />
        <SectionLabel name="slimit" />
        <InputSection
          placeholder="(optional)"
          value={query.slimit?.toString()}
          onChange={(slimit) => {
            onAppliedChange({ ...query, slimit });
          }}
        />
      </SectionWrap>
      <SectionWrap initialName="format as">
        <FormatAsSection
          format={query.resultFormat ?? DEFAULT_RESULT_FORMAT}
          onChange={(format) => {
            onAppliedChange({ ...query, resultFormat: format });
          }}
        />
        <SectionLabel name="alias" />
        <InputSection
          isWide
          placeholder="Naming pattern"
          value={query.alias}
          onChange={(alias) => {
            onAppliedChange({ ...query, alias });
          }}
        />
      </SectionWrap>
    </div>
  );
};
