// @flow

// Generated by thrift2flow at Fri Jan 04 2019 15:10:13 GMT-0500 (EST)
// Source: /Users/chrisng/thrift2flow/test-output/c215e3a7-f7c2-4c69-8002-5b7c9dcd7152/types.thrift

import * as shared from "./shared";

export type MyOtherStructXXX = shared.OtherStructXXX;

export type MyStructXXX = {|
  f_OtherStruct: shared.OtherStructXXX,
  f_MyOtherStruct: MyOtherStructXXX,
  f_OtherStructTypedef: shared.OtherStructTypedefXXX
|};
