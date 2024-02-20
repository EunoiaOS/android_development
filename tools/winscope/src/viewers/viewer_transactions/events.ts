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

class Events {
  static VSyncIdFilterChanged = 'ViewerTransactionsEvent_VSyncIdFilterChanged';
  static PidFilterChanged = 'ViewerTransactionsEvent_PidFilterChanged';
  static UidFilterChanged = 'ViewerTransactionsEvent_UidFilterChanged';
  static TypeFilterChanged = 'ViewerTransactionsEvent_TypeFilterChanged';
  static LayerIdFilterChanged = 'ViewerTransactionsEvent_LayerIdFilterChanged';
  static WhatFilterChanged = 'ViewerTransactionsEvent_WhatFilterChanged';
  static EntryClicked = 'ViewerTransactionsEvent_EntryClicked';
  static TransactionIdFilterChanged =
    'ViewerTransactionsEvent_TransactionIdFilterChanged';
  static TimestampSelected = 'ViewerTransactionsEvent_TimestampSelected';
}

export {Events};
