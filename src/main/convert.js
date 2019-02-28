/*
 * MIT License
 *
 * Copyright (c) 2017 Uber Node.js
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// @flow

import {Thrift} from 'thriftrw';
import {TypeConverter} from './types';
import prettier from 'prettier';
import path from 'path';
import {id} from './identifier';
import type {Base} from 'bufrw';
import type {
  Struct,
  Field,
  Enum,
  Typedef,
  FunctionDefinition,
  Service,
  Const,
} from 'thriftrw/ast';

const thriftOptions = {
  strict: false,
  allowFilesystemAccess: true,
  allowOptionalArguments: true,
};

export class ThriftFileConverter {
  thriftPath: string;
  thrift: Thrift;
  types: TypeConverter;
  transformName: string => string;
  withsource: boolean;
  ast: any;
  thriftAstDefinitions: Array<any>;

  constructor(
    thriftPath: string,
    transformName: string => string,
    withsource: boolean
  ) {
    this.thriftPath = path.resolve(thriftPath);
    this.thrift = new Thrift({...thriftOptions, entryPoint: thriftPath});
    this.ast = this.thrift.asts[this.thrift.filename];
    this.thriftAstDefinitions = this.ast.definitions;
    this.transformName = transformName;
    this.types = new TypeConverter(transformName, this.thriftAstDefinitions);
    this.withsource = withsource;
  }

  generateFlowFile = () => {
    const result = [
      '// @flow',
      this.withsource && `// Source: ${this.thriftPath}`,
      this.generateImports(),
      ...this.thriftAstDefinitions.map(this.convertDefinitionToCode),
    ]
      .filter(Boolean)
      .join('\n\n');
    return prettier.format(result, {parser: 'flow'});
  };

  convertDefinitionToCode = (def: any) => {
    switch (def.type) {
      case 'Struct':
      case 'Exception':
        return this.generateStruct(def);
      case 'Union':
        return this.generateUnion(def);
      case 'Enum':
        return this.generateEnum(def);
      case 'Typedef':
        return this.generateTypedef(def);
      case 'Service':
        return this.generateService(def);
      case 'Const':
        return this.generateConst(def);
      default:
        console.warn(
          `${path.basename(this.thriftPath)}: Skipping ${def.type} ${
            def.id ? def.id.name : '?'
          }`
        );
        return null;
    }
  };

  generateService = (def: Service) =>
    `export type ${this.transformName(def.id.name)} = {\n${def.functions
      .map(this.generateFunction)
      .join(',')}};`;

  generateFunction = (fn: FunctionDefinition) =>
    `${fn.id.name}: (${
      fn.fields.length ? this.generateStructContents([...fn.fields]) : ''
    }) => ${this.types.convert(fn.returns)}`;

  generateTypedef = (def: Typedef) =>
    `export type ${this.transformName(def.id.name)} = ${this.types.convert(
      def.valueType
    )};`;

  generateEnumUnion = (def: Enum) => {
    return def.definitions.map((d, index) => `"${d.id.name}"`).join(' | ');
  };

  generateEnumType = (def: Enum) => {
    return `export type ${this.transformName(
      def.id.name
    )} = ${this.generateEnumUnion(def)};`;
  };

  generateEnumMap = (def: Enum) => {
    const header = '{';
    const values = def.definitions
      .map(
        (d, index) => `  "${d.id.name}": ${d.value ? d.value.value : index},`
      )
      .join('\n');
    const footer = '}';

    const mapDefinition = [header, values, footer].join('\n');
    return `export const ${def.id.name}ValueMap = ${mapDefinition};`;
  };

  generateEnum = (def: Enum) => {
    return `${this.generateEnumType(def)}\n${this.generateEnumMap(def)}`;
  };

  generateConst = (def: Const) => {
    let value;
    if (def.value.type === 'ConstList') {
      value = `[${def.value.values
        .map(val => {
          if (val.type === 'Identifier') {
            return val.name;
          }
          if (typeof val.value === 'string') {
            return `'${val.value}'`;
          }
          return val.value;
        })
        .join(',')}]`;
    } else {
      value =
        typeof def.value.value === 'string'
          ? `'${def.value.value}'`
          : def.value.value;
    }
    return `export const ${def.id.name}: ${this.types.convert(
      def.fieldType
    )} = ${value};`;
  };

  generateStruct = ({id: {name}, fields}: Struct) =>
    `export type ${this.transformName(name)} = ${this.generateStructContents(
      fields
    )};`;

  generateStructContents = (fields: Object) =>
    `{|${Object.values(fields)
      .map(
        (f: Base) =>
          `${f.name}${this.isOptional(f) ? '?' : ''}: ${this.types.convert(
            f.valueType
          )};`
      )
      .join('\n')}|}`;

  generateUnion = ({id: {name}, fields}: Struct) =>
    `export type ${this.transformName(name)} = ${this.generateUnionContents(
      fields
    )};`;

  generateUnionContents = (fields: Object) => {
    if (!fields.length) {
      return '{||}';
    }
    return Object.values(fields)
      .map((f: Base) => {
        return `{|${f.name}: ${this.types.convert(f.valueType)}|}`;
      })
      .join(' | ');
  };

  isOptional = (field: Field) => field.optional;

  generateImports = () => {
    const includes = this.ast.headers.filter(f => f.type === 'Include');
    const relativePaths = includes
      .map(i => path.parse(i.id))
      .map(parsed => path.join(parsed.dir, parsed.name))
      .map(p => (p.startsWith('.') ? p : `./${p}`));
    const generatedImports = relativePaths.map((relpath, index) => {
      let baseName = path.basename(relpath);
      let hasConflictingImport = true;
      while (hasConflictingImport) {
        hasConflictingImport = relativePaths.some((rel, nextIndex) => {
          if (nextIndex > index && path.basename(rel) === baseName) {
            return true;
          }
          return false;
        });
        if (hasConflictingImport) {
          baseName = `_${baseName}`;
        }
      }
      return `import * as ${id(baseName)} from '${relpath}';`;
    });

    if (this.isLongDefined()) {
      generatedImports.push("import Long from 'long'");
    }
    return generatedImports.join('\n');
  };
  getImportAbsPaths = () =>
    Object.keys(this.thrift.idls).map(p => path.resolve(p));

  isLongDefined = () => {
    for (const astNode of this.thriftAstDefinitions) {
      if (astNode.type === 'Struct') {
        for (const field of astNode.fields) {
          if (field.valueType == null || field.valueType.annotations == null) {
            continue;
          }

          if (field.valueType.annotations['js.type'] === 'Long') {
            return true;
          }
        }
      } else if (astNode.type === 'Typedef') {
        if (
          astNode.valueType == null ||
          astNode.valueType.annotations == null
        ) {
          continue;
        }

        if (astNode.valueType.annotations['js.type'] === 'Long') {
          return true;
        }
      }
    }

    return false;
  };
}
