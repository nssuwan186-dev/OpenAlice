/**
 * Mirrors: ibapi/decoder.py
 *
 * The Decoder knows how to transform a message's payload into higher level
 * IB message (eg: order info, mkt data, etc).
 * It will call the corresponding method from the EWrapper so that customer's code
 * (eg: class derived from EWrapper) can make further use of the data.
 */

import type { EWrapper } from './wrapper.js'
import { IN } from './message.js'
import { NO_VALID_ID, UNSET_INTEGER } from './const.js'
import {
  decodeStr,
  decodeInt,
  decodeFloat,
  decodeBool,
  decodeDecimal,
  BadMessage,
  currentTimeMillis,
} from './utils.js'
import {
  MIN_SERVER_VER_PAST_LIMIT,
  MIN_SERVER_VER_PRE_OPEN_BID_ASK,
  MIN_SERVER_VER_MARKET_CAP_PRICE,
  MIN_SERVER_VER_ORDER_CONTAINER,
  MIN_SERVER_VER_SIZE_RULES,
  MIN_SERVER_VER_MD_SIZE_MULTIPLIER,
  MIN_SERVER_VER_ENCODE_MSG_ASCII7,
  MIN_SERVER_VER_AGG_GROUP,
  MIN_SERVER_VER_UNDERLYING_INFO,
  MIN_SERVER_VER_MARKET_RULES,
  MIN_SERVER_VER_REAL_EXPIRATION_DATE,
  MIN_SERVER_VER_STOCK_TYPE,
  MIN_SERVER_VER_FRACTIONAL_SIZE_SUPPORT,
  MIN_SERVER_VER_FUND_DATA_FIELDS,
  MIN_SERVER_VER_INELIGIBILITY_REASONS,
  MIN_SERVER_VER_LAST_TRADE_DATE,
  MIN_SERVER_VER_BOND_TRADING_HOURS,
  MIN_SERVER_VER_LAST_LIQUIDITY,
  MIN_SERVER_VER_MODELS_SUPPORT,
  MIN_SERVER_VER_PENDING_PRICE_REVISION,
  MIN_SERVER_VER_SUBMITTER,
  MIN_SERVER_VER_SYNT_REALTIME_BARS,
  MIN_SERVER_VER_HISTORICAL_DATA_END,
  MIN_SERVER_VER_PRICE_BASED_VOLATILITY,
  MIN_SERVER_VER_SERVICE_DATA_TYPE,
  MIN_SERVER_VER_SMART_DEPTH,
  MIN_SERVER_VER_UNREALIZED_PNL,
  MIN_SERVER_VER_REALIZED_PNL,
  MIN_SERVER_VER_BOND_ISSUERID,
  MIN_SERVER_VER_ADVANCED_ORDER_REJECT,
  MIN_SERVER_VER_ERROR_TIME,
  MIN_SERVER_VER_AUTO_CANCEL_PARENT,
  MIN_SERVER_VER_IMBALANCE_ONLY,
} from './server-versions.js'
import { OrderDecoder } from './order-decoder.js'
import { Contract, ContractDetails, ContractDescription, DeltaNeutralContract, FundDistributionPolicyIndicator, FundAssetType } from './contract.js'
import { Order } from './order.js'
import { OrderState } from './order-state.js'
import { Execution } from './execution.js'
import { CommissionAndFeesReport } from './commission-and-fees-report.js'
import { SoftDollarTier } from './softdollartier.js'
import { TagValue } from './tag-value.js'
import { IneligibilityReason } from './ineligibility-reason.js'
import { TickTypeEnum } from './tick-type.js'
import { BAD_MESSAGE, UNKNOWN_ID } from './errors.js'
import {
  BarData,
  RealTimeBar,
  TickAttrib,
  TickAttribBidAsk,
  TickAttribLast,
  FamilyCode,
  SmartComponent,
  DepthMktDataDescription,
  PriceIncrement,
  HistogramData,
  HistoricalTick,
  HistoricalTickBidAsk,
  HistoricalTickLast,
  HistoricalSession,
  NewsProvider,
} from './common.js'
import { ScanData } from './scanner.js'

/** Helper: look up an enum-like object by its code string. */
function getEnumTypeFromString(
  enumObj: Record<string, readonly [string, string]>,
  code: string,
): readonly [string, string] {
  for (const val of Object.values(enumObj)) {
    if (val[0] === code) return val
  }
  return enumObj['NoneItem'] ?? ['None', 'None']
}

/** Helper: read and split a "last trade date" composite field. */
function setLastTradeDate(
  lastTradeDateOrContractMonth: string,
  contract: ContractDetails,
  isBond: boolean,
): void {
  if (!lastTradeDateOrContractMonth) return
  const parts = lastTradeDateOrContractMonth.split(/\s+/)
  if (parts.length > 0) {
    if (isBond) {
      contract.maturity = parts[0]
    } else {
      contract.contract.lastTradeDateOrContractMonth = parts[0]
    }
  }
  if (parts.length > 1) {
    contract.lastTradeTime = parts[1]
  }
  if (isBond && parts.length > 2) {
    contract.timeZoneId = parts[2]
  }
}

export class Decoder {
  private wrapper: EWrapper
  private serverVersion: number
  private readonly msgId2handler: Map<number, (fields: Iterator<string>) => void>

  constructor(wrapper: EWrapper, serverVersion: number) {
    this.wrapper = wrapper
    this.serverVersion = serverVersion

    this.msgId2handler = new Map<number, (fields: Iterator<string>) => void>([
      // --- Messages with dedicated process methods ---
      [IN.TICK_PRICE, (f) => this.processTickPriceMsg(f)],
      [IN.TICK_SIZE, (f) => this.processTickSizeMsg(f)],
      [IN.ORDER_STATUS, (f) => this.processOrderStatusMsg(f)],
      [IN.ERR_MSG, (f) => this.processErrorMsg(f)],
      [IN.OPEN_ORDER, (f) => this.processOpenOrder(f)],
      [IN.ACCT_VALUE, (f) => this.processAcctValueMsg(f)],
      [IN.PORTFOLIO_VALUE, (f) => this.processPortfolioValueMsg(f)],
      [IN.ACCT_UPDATE_TIME, (f) => this.processAcctUpdateTimeMsg(f)],
      [IN.NEXT_VALID_ID, (f) => this.processNextValidIdMsg(f)],
      [IN.CONTRACT_DATA, (f) => this.processContractDataMsg(f)],
      [IN.EXECUTION_DATA, (f) => this.processExecutionDataMsg(f)],
      [IN.MARKET_DEPTH, (f) => this.processMarketDepthMsg(f)],
      [IN.MARKET_DEPTH_L2, (f) => this.processMarketDepthL2Msg(f)],
      [IN.NEWS_BULLETINS, (f) => this.processNewsBulletinsMsg(f)],
      [IN.MANAGED_ACCTS, (f) => this.processManagedAcctsMsg(f)],
      [IN.RECEIVE_FA, (f) => this.processReceiveFaMsg(f)],
      [IN.HISTORICAL_DATA, (f) => this.processHistoricalDataMsg(f)],
      [IN.HISTORICAL_DATA_UPDATE, (f) => this.processHistoricalDataUpdateMsg(f)],
      [IN.BOND_CONTRACT_DATA, (f) => this.processBondContractDataMsg(f)],
      [IN.SCANNER_PARAMETERS, (f) => this.processScannerParametersMsg(f)],
      [IN.SCANNER_DATA, (f) => this.processScannerDataMsg(f)],
      [IN.TICK_OPTION_COMPUTATION, (f) => this.processTickOptionComputationMsg(f)],
      [IN.TICK_GENERIC, (f) => this.processTickGenericMsg(f)],
      [IN.TICK_STRING, (f) => this.processTickStringMsg(f)],
      [IN.TICK_EFP, (f) => this.processTickEfpMsg(f)],
      [IN.CURRENT_TIME, (f) => this.processCurrentTimeMsg(f)],
      [IN.REAL_TIME_BARS, (f) => this.processRealTimeBarMsg(f)],
      [IN.FUNDAMENTAL_DATA, (f) => this.processFundamentalDataMsg(f)],
      [IN.CONTRACT_DATA_END, (f) => this.processContractDataEndMsg(f)],
      [IN.OPEN_ORDER_END, (f) => this.processOpenOrderEndMsg(f)],
      [IN.ACCT_DOWNLOAD_END, (f) => this.processAcctDownloadEndMsg(f)],
      [IN.EXECUTION_DATA_END, (f) => this.processExecDetailsEndMsg(f)],
      [IN.DELTA_NEUTRAL_VALIDATION, (f) => this.processDeltaNeutralValidationMsg(f)],
      [IN.TICK_SNAPSHOT_END, (f) => this.processTickSnapshotEndMsg(f)],
      [IN.MARKET_DATA_TYPE, (f) => this.processMarketDataTypeMsg(f)],
      [IN.COMMISSION_AND_FEES_REPORT, (f) => this.processCommissionAndFeesReportMsg(f)],
      [IN.POSITION_DATA, (f) => this.processPositionDataMsg(f)],
      [IN.POSITION_END, (f) => this.processPositionEndMsg(f)],
      [IN.ACCOUNT_SUMMARY, (f) => this.processAccountSummaryMsg(f)],
      [IN.ACCOUNT_SUMMARY_END, (f) => this.processAccountSummaryEndMsg(f)],
      [IN.VERIFY_MESSAGE_API, (f) => this.processVerifyMessageApiMsg(f)],
      [IN.VERIFY_COMPLETED, (f) => this.processVerifyCompletedMsg(f)],
      [IN.DISPLAY_GROUP_LIST, (f) => this.processDisplayGroupListMsg(f)],
      [IN.DISPLAY_GROUP_UPDATED, (f) => this.processDisplayGroupUpdatedMsg(f)],
      [IN.VERIFY_AND_AUTH_MESSAGE_API, (f) => this.processVerifyAndAuthMessageApiMsg(f)],
      [IN.VERIFY_AND_AUTH_COMPLETED, (f) => this.processVerifyAndAuthCompletedMsg(f)],
      [IN.POSITION_MULTI, (f) => this.processPositionMultiMsg(f)],
      [IN.POSITION_MULTI_END, (f) => this.processPositionMultiEndMsg(f)],
      [IN.ACCOUNT_UPDATE_MULTI, (f) => this.processAccountUpdateMultiMsg(f)],
      [IN.ACCOUNT_UPDATE_MULTI_END, (f) => this.processAccountUpdateMultiEndMsg(f)],
      [IN.SECURITY_DEFINITION_OPTION_PARAMETER, (f) => this.processSecurityDefinitionOptionParameterMsg(f)],
      [IN.SECURITY_DEFINITION_OPTION_PARAMETER_END, (f) => this.processSecurityDefinitionOptionParameterEndMsg(f)],
      [IN.SOFT_DOLLAR_TIERS, (f) => this.processSoftDollarTiersMsg(f)],
      [IN.FAMILY_CODES, (f) => this.processFamilyCodesMsg(f)],
      [IN.SYMBOL_SAMPLES, (f) => this.processSymbolSamplesMsg(f)],
      [IN.SMART_COMPONENTS, (f) => this.processSmartComponents(f)],
      [IN.TICK_REQ_PARAMS, (f) => this.processTickReqParams(f)],
      [IN.MKT_DEPTH_EXCHANGES, (f) => this.processMktDepthExchanges(f)],
      [IN.HEAD_TIMESTAMP, (f) => this.processHeadTimestamp(f)],
      [IN.TICK_NEWS, (f) => this.processTickNews(f)],
      [IN.NEWS_PROVIDERS, (f) => this.processNewsProviders(f)],
      [IN.NEWS_ARTICLE, (f) => this.processNewsArticle(f)],
      [IN.HISTORICAL_NEWS, (f) => this.processHistoricalNews(f)],
      [IN.HISTORICAL_NEWS_END, (f) => this.processHistoricalNewsEnd(f)],
      [IN.HISTOGRAM_DATA, (f) => this.processHistogramData(f)],
      [IN.REROUTE_MKT_DATA_REQ, (f) => this.processRerouteMktDataReq(f)],
      [IN.REROUTE_MKT_DEPTH_REQ, (f) => this.processRerouteMktDepthReq(f)],
      [IN.MARKET_RULE, (f) => this.processMarketRuleMsg(f)],
      [IN.PNL, (f) => this.processPnLMsg(f)],
      [IN.PNL_SINGLE, (f) => this.processPnLSingleMsg(f)],
      [IN.HISTORICAL_TICKS, (f) => this.processHistoricalTicks(f)],
      [IN.HISTORICAL_TICKS_BID_ASK, (f) => this.processHistoricalTicksBidAsk(f)],
      [IN.HISTORICAL_TICKS_LAST, (f) => this.processHistoricalTicksLast(f)],
      [IN.TICK_BY_TICK, (f) => this.processTickByTickMsg(f)],
      [IN.ORDER_BOUND, (f) => this.processOrderBoundMsg(f)],
      [IN.COMPLETED_ORDER, (f) => this.processCompletedOrderMsg(f)],
      [IN.COMPLETED_ORDERS_END, (f) => this.processCompletedOrdersEndMsg(f)],
      [IN.REPLACE_FA_END, (f) => this.processReplaceFAEndMsg(f)],
      [IN.WSH_META_DATA, (f) => this.processWshMetaDataMsg(f)],
      [IN.WSH_EVENT_DATA, (f) => this.processWshEventDataMsg(f)],
      [IN.HISTORICAL_SCHEDULE, (f) => this.processHistoricalSchedule(f)],
      [IN.USER_INFO, (f) => this.processUserInfo(f)],
      [IN.HISTORICAL_DATA_END, (f) => this.processHistoricalDataEndMsg(f)],
      [IN.CURRENT_TIME_IN_MILLIS, (f) => this.processCurrentTimeInMillis(f)],
    ])
  }

  // ----------------------------------------------------------------
  // Main entry point
  // ----------------------------------------------------------------

  interpret(fields: string[]): void {
    const msgId = parseInt(fields[0] || '0', 10)
    if (msgId === 0) return

    const handler = this.msgId2handler.get(msgId)
    if (!handler) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), UNKNOWN_ID.code(), UNKNOWN_ID.msg(), '')
      return
    }

    try {
      handler(fields[Symbol.iterator]())
    } catch (e) {
      if (e instanceof BadMessage) {
        const theBadMsg = fields.join(',')
        this.wrapper.error(
          NO_VALID_ID,
          currentTimeMillis(),
          BAD_MESSAGE.code(),
          BAD_MESSAGE.msg() + theBadMsg,
          '',
        )
      }
      throw e
    }
  }

  // ----------------------------------------------------------------
  // Simple "wrap" style messages (auto-decoded by signature)
  // These methods skip the msgId (first field) and version, then
  // forward the remaining fields to the wrapper.
  // ----------------------------------------------------------------

  private processAcctValueMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const key = decodeStr(fields)
    const val = decodeStr(fields)
    const currency = decodeStr(fields)
    const accountName = decodeStr(fields)
    this.wrapper.updateAccountValue(key, val, currency, accountName)
  }

  private processAcctUpdateTimeMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const timeStamp = decodeStr(fields)
    this.wrapper.updateAccountTime(timeStamp)
  }

  private processNextValidIdMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const orderId = decodeInt(fields)
    this.wrapper.nextValidId(orderId)
  }

  private processNewsBulletinsMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const msgId = decodeInt(fields)
    const msgType = decodeInt(fields)
    const message = decodeStr(fields)
    const originExch = decodeStr(fields)
    this.wrapper.updateNewsBulletin(msgId, msgType, message, originExch)
  }

  private processManagedAcctsMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const accountsList = decodeStr(fields)
    this.wrapper.managedAccounts(accountsList)
  }

  private processReceiveFaMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const faDataType = decodeInt(fields)
    const xml = decodeStr(fields)
    this.wrapper.receiveFA(faDataType, xml)
  }

  private processScannerParametersMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const xml = decodeStr(fields)
    this.wrapper.scannerParameters(xml)
  }

  private processTickGenericMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const tickType = decodeInt(fields)
    const value = decodeFloat(fields)
    this.wrapper.tickGeneric(reqId, tickType, value)
  }

  private processTickStringMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const tickType = decodeInt(fields)
    const value = decodeStr(fields)
    this.wrapper.tickString(reqId, tickType, value)
  }

  private processTickEfpMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const tickType = decodeInt(fields)
    const basisPoints = decodeFloat(fields)
    const formattedBasisPoints = decodeStr(fields)
    const impliedFuturesPrice = decodeFloat(fields)
    const holdDays = decodeInt(fields)
    const futureLastTradeDate = decodeStr(fields)
    const dividendImpact = decodeFloat(fields)
    const dividendsToLastTradeDate = decodeFloat(fields)
    this.wrapper.tickEFP(
      reqId, tickType, basisPoints, formattedBasisPoints,
      impliedFuturesPrice, holdDays, futureLastTradeDate,
      dividendImpact, dividendsToLastTradeDate,
    )
  }

  private processCurrentTimeMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const time = decodeInt(fields)
    this.wrapper.currentTime(time)
  }

  private processFundamentalDataMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const data = decodeStr(fields)
    this.wrapper.fundamentalData(reqId, data)
  }

  private processContractDataEndMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    this.wrapper.contractDetailsEnd(reqId)
  }

  private processOpenOrderEndMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    this.wrapper.openOrderEnd()
  }

  private processAcctDownloadEndMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const accountName = decodeStr(fields)
    this.wrapper.accountDownloadEnd(accountName)
  }

  private processExecDetailsEndMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    this.wrapper.execDetailsEnd(reqId)
  }

  private processTickSnapshotEndMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    this.wrapper.tickSnapshotEnd(reqId)
  }

  private processPositionEndMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    this.wrapper.positionEnd()
  }

  private processAccountSummaryMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const account = decodeStr(fields)
    const tag = decodeStr(fields)
    const value = decodeStr(fields)
    const currency = decodeStr(fields)
    this.wrapper.accountSummary(reqId, account, tag, value, currency)
  }

  private processAccountSummaryEndMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    this.wrapper.accountSummaryEnd(reqId)
  }

  private processVerifyMessageApiMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const apiData = decodeStr(fields)
    this.wrapper.verifyMessageAPI(apiData)
  }

  private processVerifyCompletedMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const isSuccessful = decodeBool(fields)
    const errorText = decodeStr(fields)
    this.wrapper.verifyCompleted(isSuccessful, errorText)
  }

  private processDisplayGroupListMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const groups = decodeStr(fields)
    this.wrapper.displayGroupList(reqId, groups)
  }

  private processDisplayGroupUpdatedMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const contractInfo = decodeStr(fields)
    this.wrapper.displayGroupUpdated(reqId, contractInfo)
  }

  private processVerifyAndAuthMessageApiMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const apiData = decodeStr(fields)
    const xyzChallenge = decodeStr(fields)
    this.wrapper.verifyAndAuthMessageAPI(apiData, xyzChallenge)
  }

  private processVerifyAndAuthCompletedMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const isSuccessful = decodeBool(fields)
    const errorText = decodeStr(fields)
    this.wrapper.verifyAndAuthCompleted(isSuccessful, errorText)
  }

  private processPositionMultiEndMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    this.wrapper.positionMultiEnd(reqId)
  }

  private processAccountUpdateMultiMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const account = decodeStr(fields)
    const modelCode = decodeStr(fields)
    const key = decodeStr(fields)
    const value = decodeStr(fields)
    const currency = decodeStr(fields)
    this.wrapper.accountUpdateMulti(reqId, account, modelCode, key, value, currency)
  }

  private processAccountUpdateMultiEndMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    this.wrapper.accountUpdateMultiEnd(reqId)
  }

  private processMarketDataTypeMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId (version)
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const marketDataType = decodeInt(fields)
    this.wrapper.marketDataType(reqId, marketDataType)
  }

  // ----------------------------------------------------------------
  // Complex process methods
  // ----------------------------------------------------------------

  private processTickPriceMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version

    const reqId = decodeInt(fields)
    const tickType = decodeInt(fields)
    const price = decodeFloat(fields)
    const size = decodeDecimal(fields) // ver 2 field
    const attrMask = decodeInt(fields) // ver 3 field

    const attrib = new TickAttrib()

    attrib.canAutoExecute = attrMask === 1

    if (this.serverVersion >= MIN_SERVER_VER_PAST_LIMIT) {
      attrib.canAutoExecute = (attrMask & 1) !== 0
      attrib.pastLimit = (attrMask & 2) !== 0
      if (this.serverVersion >= MIN_SERVER_VER_PRE_OPEN_BID_ASK) {
        attrib.preOpen = (attrMask & 4) !== 0
      }
    }

    this.wrapper.tickPrice(reqId, tickType, price, attrib)

    // process ver 2 fields
    let sizeTickType: number = TickTypeEnum.NOT_SET
    if (TickTypeEnum.BID === tickType) {
      sizeTickType = TickTypeEnum.BID_SIZE
    } else if (TickTypeEnum.ASK === tickType) {
      sizeTickType = TickTypeEnum.ASK_SIZE
    } else if (TickTypeEnum.LAST === tickType) {
      sizeTickType = TickTypeEnum.LAST_SIZE
    } else if (TickTypeEnum.DELAYED_BID === tickType) {
      sizeTickType = TickTypeEnum.DELAYED_BID_SIZE
    } else if (TickTypeEnum.DELAYED_ASK === tickType) {
      sizeTickType = TickTypeEnum.DELAYED_ASK_SIZE
    } else if (TickTypeEnum.DELAYED_LAST === tickType) {
      sizeTickType = TickTypeEnum.DELAYED_LAST_SIZE
    }

    if (sizeTickType !== TickTypeEnum.NOT_SET) {
      this.wrapper.tickSize(reqId, sizeTickType, size)
    }
  }

  private processTickSizeMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version

    const reqId = decodeInt(fields)
    const sizeTickType = decodeInt(fields)
    const size = decodeDecimal(fields)

    if (sizeTickType !== TickTypeEnum.NOT_SET) {
      this.wrapper.tickSize(reqId, sizeTickType, size)
    }
  }

  private processOrderStatusMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    if (this.serverVersion < MIN_SERVER_VER_MARKET_CAP_PRICE) {
      decodeInt(fields) // version
    }
    const orderId = decodeInt(fields)
    const status = decodeStr(fields)
    const filled = decodeDecimal(fields)
    const remaining = decodeDecimal(fields)
    const avgFillPrice = decodeFloat(fields)

    const permId = decodeInt(fields) // ver 2
    const parentId = decodeInt(fields) // ver 3
    const lastFillPrice = decodeFloat(fields) // ver 4
    const clientId = decodeInt(fields) // ver 5
    const whyHeld = decodeStr(fields) // ver 6

    let mktCapPrice = 0
    if (this.serverVersion >= MIN_SERVER_VER_MARKET_CAP_PRICE) {
      mktCapPrice = decodeFloat(fields)
    }

    this.wrapper.orderStatus(
      orderId, status, filled, remaining, avgFillPrice,
      permId, parentId, lastFillPrice, clientId, whyHeld,
      mktCapPrice,
    )
  }

  private processOpenOrder(fields: Iterator<string>): void {
    decodeInt(fields) // msgId

    const order = new Order()
    const contract = new Contract()
    const orderState = new OrderState()

    let version: number
    if (this.serverVersion < MIN_SERVER_VER_ORDER_CONTAINER) {
      version = decodeInt(fields)
    } else {
      version = this.serverVersion
    }

    const od = new OrderDecoder(contract, order, orderState, version, this.serverVersion)

    od.decodeOrderId(fields)
    od.decodeContractFields(fields)
    od.decodeAction(fields)
    od.decodeTotalQuantity(fields)
    od.decodeOrderType(fields)
    od.decodeLmtPrice(fields)
    od.decodeAuxPrice(fields)
    od.decodeTIF(fields)
    od.decodeOcaGroup(fields)
    od.decodeAccount(fields)
    od.decodeOpenClose(fields)
    od.decodeOrigin(fields)
    od.decodeOrderRef(fields)
    od.decodeClientId(fields)
    od.decodePermId(fields)
    od.decodeOutsideRth(fields)
    od.decodeHidden(fields)
    od.decodeDiscretionaryAmt(fields)
    od.decodeGoodAfterTime(fields)
    od.skipSharesAllocation(fields)
    od.decodeFAParams(fields)
    od.decodeModelCode(fields)
    od.decodeGoodTillDate(fields)
    od.decodeRule80A(fields)
    od.decodePercentOffset(fields)
    od.decodeSettlingFirm(fields)
    od.decodeShortSaleParams(fields)
    od.decodeAuctionStrategy(fields)
    od.decodeBoxOrderParams(fields)
    od.decodePegToStkOrVolOrderParams(fields)
    od.decodeDisplaySize(fields)
    od.decodeBlockOrder(fields)
    od.decodeSweepToFill(fields)
    od.decodeAllOrNone(fields)
    od.decodeMinQty(fields)
    od.decodeOcaType(fields)
    od.skipETradeOnly(fields)
    od.skipFirmQuoteOnly(fields)
    od.skipNbboPriceCap(fields)
    od.decodeParentId(fields)
    od.decodeTriggerMethod(fields)
    od.decodeVolOrderParams(fields, true)
    od.decodeTrailParams(fields)
    od.decodeBasisPoints(fields)
    od.decodeComboLegs(fields)
    od.decodeSmartComboRoutingParams(fields)
    od.decodeScaleOrderParams(fields)
    od.decodeHedgeParams(fields)
    od.decodeOptOutSmartRouting(fields)
    od.decodeClearingParams(fields)
    od.decodeNotHeld(fields)
    od.decodeDeltaNeutral(fields)
    od.decodeAlgoParams(fields)
    od.decodeSolicited(fields)
    od.decodeWhatIfInfoAndCommissionAndFees(fields)
    od.decodeVolRandomizeFlags(fields)
    od.decodePegToBenchParams(fields)
    od.decodeConditions(fields)
    od.decodeAdjustedOrderParams(fields)
    od.decodeSoftDollarTier(fields)
    od.decodeCashQty(fields)
    od.decodeDontUseAutoPriceForHedge(fields)
    od.decodeIsOmsContainers(fields)
    od.decodeDiscretionaryUpToLimitPrice(fields)
    od.decodeUsePriceMgmtAlgo(fields)
    od.decodeDuration(fields)
    od.decodePostToAts(fields)
    od.decodeAutoCancelParent(fields, MIN_SERVER_VER_AUTO_CANCEL_PARENT)
    od.decodePegBestPegMidOrderAttributes(fields)
    od.decodeCustomerAccount(fields)
    od.decodeProfessionalCustomer(fields)
    od.decodeBondAccruedInterest(fields)
    od.decodeIncludeOvernight(fields)
    od.decodeCMETaggingFields(fields)
    od.decodeSubmitter(fields)
    od.decodeImbalanceOnly(fields, MIN_SERVER_VER_IMBALANCE_ONLY)

    this.wrapper.openOrder(order.orderId, contract, order, orderState)
  }

  private processPortfolioValueMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const version = decodeInt(fields)

    const contract = new Contract()
    contract.conId = decodeInt(fields) // ver 6
    contract.symbol = decodeStr(fields)
    contract.secType = decodeStr(fields)
    contract.lastTradeDateOrContractMonth = decodeStr(fields)
    contract.strike = decodeFloat(fields)
    contract.right = decodeStr(fields)

    if (version >= 7) {
      contract.multiplier = decodeStr(fields)
      contract.primaryExchange = decodeStr(fields)
    }

    contract.currency = decodeStr(fields)
    contract.localSymbol = decodeStr(fields) // ver 2
    if (version >= 8) {
      contract.tradingClass = decodeStr(fields)
    }

    const position = decodeDecimal(fields)
    const marketPrice = decodeFloat(fields)
    const marketValue = decodeFloat(fields)
    const averageCost = decodeFloat(fields) // ver 3
    const unrealizedPNL = decodeFloat(fields) // ver 3
    const realizedPNL = decodeFloat(fields) // ver 3
    const accountName = decodeStr(fields) // ver 4

    if (version === 6 && this.serverVersion === 39) {
      contract.primaryExchange = decodeStr(fields)
    }

    this.wrapper.updatePortfolio(
      contract, position, marketPrice, marketValue,
      averageCost, unrealizedPNL, realizedPNL, accountName,
    )
  }

  private processContractDataMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    let version = 8
    if (this.serverVersion < MIN_SERVER_VER_SIZE_RULES) {
      version = decodeInt(fields)
    }

    let reqId = -1
    if (version >= 3) {
      reqId = decodeInt(fields)
    }

    const contract = new ContractDetails()
    contract.contract.symbol = decodeStr(fields)
    contract.contract.secType = decodeStr(fields)
    this.readLastTradeDate(fields, contract, false)
    if (this.serverVersion >= MIN_SERVER_VER_LAST_TRADE_DATE) {
      contract.contract.lastTradeDate = decodeStr(fields)
    }
    contract.contract.strike = decodeFloat(fields)
    contract.contract.right = decodeStr(fields)
    contract.contract.exchange = decodeStr(fields)
    contract.contract.currency = decodeStr(fields)
    contract.contract.localSymbol = decodeStr(fields)
    contract.marketName = decodeStr(fields)
    contract.contract.tradingClass = decodeStr(fields)
    contract.contract.conId = decodeInt(fields)
    contract.minTick = decodeFloat(fields)
    if (
      this.serverVersion >= MIN_SERVER_VER_MD_SIZE_MULTIPLIER &&
      this.serverVersion < MIN_SERVER_VER_SIZE_RULES
    ) {
      decodeInt(fields) // mdSizeMultiplier - not used anymore
    }
    contract.contract.multiplier = decodeStr(fields)
    contract.orderTypes = decodeStr(fields)
    contract.validExchanges = decodeStr(fields)
    contract.priceMagnifier = decodeInt(fields) // ver 2
    if (version >= 4) {
      contract.underConId = decodeInt(fields)
    }
    if (version >= 5) {
      contract.longName =
        this.serverVersion >= MIN_SERVER_VER_ENCODE_MSG_ASCII7
          ? decodeStr(fields) // Python does unicode-escape; we just read the string
          : decodeStr(fields)
      contract.contract.primaryExchange = decodeStr(fields)
    }
    if (version >= 6) {
      contract.contractMonth = decodeStr(fields)
      contract.industry = decodeStr(fields)
      contract.category = decodeStr(fields)
      contract.subcategory = decodeStr(fields)
      contract.timeZoneId = decodeStr(fields)
      contract.tradingHours = decodeStr(fields)
      contract.liquidHours = decodeStr(fields)
    }
    if (version >= 8) {
      contract.evRule = decodeStr(fields)
      contract.evMultiplier = decodeInt(fields)
    }
    if (version >= 7) {
      const secIdListCount = decodeInt(fields)
      if (secIdListCount > 0) {
        contract.secIdList = []
        for (let i = 0; i < secIdListCount; i++) {
          const tagValue = new TagValue()
          tagValue.tag = decodeStr(fields)
          tagValue.value = decodeStr(fields)
          contract.secIdList.push(tagValue)
        }
      }
    }

    if (this.serverVersion >= MIN_SERVER_VER_AGG_GROUP) {
      contract.aggGroup = decodeInt(fields)
    }

    if (this.serverVersion >= MIN_SERVER_VER_UNDERLYING_INFO) {
      contract.underSymbol = decodeStr(fields)
      contract.underSecType = decodeStr(fields)
    }

    if (this.serverVersion >= MIN_SERVER_VER_MARKET_RULES) {
      contract.marketRuleIds = decodeStr(fields)
    }

    if (this.serverVersion >= MIN_SERVER_VER_REAL_EXPIRATION_DATE) {
      contract.realExpirationDate = decodeStr(fields)
    }

    if (this.serverVersion >= MIN_SERVER_VER_STOCK_TYPE) {
      contract.stockType = decodeStr(fields)
    }

    if (
      this.serverVersion >= MIN_SERVER_VER_FRACTIONAL_SIZE_SUPPORT &&
      this.serverVersion < MIN_SERVER_VER_SIZE_RULES
    ) {
      decodeDecimal(fields) // sizeMinTick - not used anymore
    }

    if (this.serverVersion >= MIN_SERVER_VER_SIZE_RULES) {
      contract.minSize = decodeDecimal(fields)
      contract.sizeIncrement = decodeDecimal(fields)
      contract.suggestedSizeIncrement = decodeDecimal(fields)
    }

    if (
      this.serverVersion >= MIN_SERVER_VER_FUND_DATA_FIELDS &&
      contract.contract.secType === 'FUND'
    ) {
      contract.fundName = decodeStr(fields)
      contract.fundFamily = decodeStr(fields)
      contract.fundType = decodeStr(fields)
      contract.fundFrontLoad = decodeStr(fields)
      contract.fundBackLoad = decodeStr(fields)
      contract.fundBackLoadTimeInterval = decodeStr(fields)
      contract.fundManagementFee = decodeStr(fields)
      contract.fundClosed = decodeBool(fields)
      contract.fundClosedForNewInvestors = decodeBool(fields)
      contract.fundClosedForNewMoney = decodeBool(fields)
      contract.fundNotifyAmount = decodeStr(fields)
      contract.fundMinimumInitialPurchase = decodeStr(fields)
      contract.fundSubsequentMinimumPurchase = decodeStr(fields)
      contract.fundBlueSkyStates = decodeStr(fields)
      contract.fundBlueSkyTerritories = decodeStr(fields)
      contract.fundDistributionPolicyIndicator = getEnumTypeFromString(
        FundDistributionPolicyIndicator, decodeStr(fields),
      ) as typeof contract.fundDistributionPolicyIndicator
      contract.fundAssetType = getEnumTypeFromString(
        FundAssetType, decodeStr(fields),
      ) as typeof contract.fundAssetType
    }

    if (this.serverVersion >= MIN_SERVER_VER_INELIGIBILITY_REASONS) {
      const ineligibilityReasonListCount = decodeInt(fields)
      if (ineligibilityReasonListCount > 0) {
        contract.ineligibilityReasonList = []
        for (let i = 0; i < ineligibilityReasonListCount; i++) {
          const reason = new IneligibilityReason()
          reason.id = decodeStr(fields)
          reason.description = decodeStr(fields)
          contract.ineligibilityReasonList.push(reason)
        }
      }
    }

    this.wrapper.contractDetails(reqId, contract)
  }

  private processBondContractDataMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    let version = 6
    if (this.serverVersion < MIN_SERVER_VER_SIZE_RULES) {
      version = decodeInt(fields)
    }

    let reqId = -1
    if (version >= 3) {
      reqId = decodeInt(fields)
    }

    const contract = new ContractDetails()
    contract.contract.symbol = decodeStr(fields)
    contract.contract.secType = decodeStr(fields)
    contract.cusip = decodeStr(fields)
    contract.coupon = decodeFloat(fields)
    this.readLastTradeDate(fields, contract, true)
    contract.issueDate = decodeStr(fields)
    contract.ratings = decodeStr(fields)
    contract.bondType = decodeStr(fields)
    contract.couponType = decodeStr(fields)
    contract.convertible = decodeBool(fields)
    contract.callable = decodeBool(fields)
    contract.putable = decodeBool(fields)
    contract.descAppend = decodeStr(fields)
    contract.contract.exchange = decodeStr(fields)
    contract.contract.currency = decodeStr(fields)
    contract.marketName = decodeStr(fields)
    contract.contract.tradingClass = decodeStr(fields)
    contract.contract.conId = decodeInt(fields)
    contract.minTick = decodeFloat(fields)
    if (
      this.serverVersion >= MIN_SERVER_VER_MD_SIZE_MULTIPLIER &&
      this.serverVersion < MIN_SERVER_VER_SIZE_RULES
    ) {
      decodeInt(fields) // mdSizeMultiplier - not used anymore
    }
    contract.orderTypes = decodeStr(fields)
    contract.validExchanges = decodeStr(fields)
    contract.nextOptionDate = decodeStr(fields) // ver 2
    contract.nextOptionType = decodeStr(fields) // ver 2
    contract.nextOptionPartial = decodeBool(fields) // ver 2
    contract.notes = decodeStr(fields) // ver 2
    if (version >= 4) {
      contract.longName = decodeStr(fields)
    }
    if (this.serverVersion >= MIN_SERVER_VER_BOND_TRADING_HOURS) {
      contract.timeZoneId = decodeStr(fields)
      contract.tradingHours = decodeStr(fields)
      contract.liquidHours = decodeStr(fields)
    }
    if (version >= 6) {
      contract.evRule = decodeStr(fields)
      contract.evMultiplier = decodeInt(fields)
    }
    if (version >= 5) {
      const secIdListCount = decodeInt(fields)
      if (secIdListCount > 0) {
        contract.secIdList = []
        for (let i = 0; i < secIdListCount; i++) {
          const tagValue = new TagValue()
          tagValue.tag = decodeStr(fields)
          tagValue.value = decodeStr(fields)
          contract.secIdList.push(tagValue)
        }
      }
    }

    if (this.serverVersion >= MIN_SERVER_VER_AGG_GROUP) {
      contract.aggGroup = decodeInt(fields)
    }

    if (this.serverVersion >= MIN_SERVER_VER_MARKET_RULES) {
      contract.marketRuleIds = decodeStr(fields)
    }

    if (this.serverVersion >= MIN_SERVER_VER_SIZE_RULES) {
      contract.minSize = decodeDecimal(fields)
      contract.sizeIncrement = decodeDecimal(fields)
      contract.suggestedSizeIncrement = decodeDecimal(fields)
    }

    this.wrapper.bondContractDetails(reqId, contract)
  }

  private processScannerDataMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)

    const numberOfElements = decodeInt(fields)

    for (let i = 0; i < numberOfElements; i++) {
      const data = new ScanData()
      const contractDetails = new ContractDetails()
      data.contract = contractDetails.contract

      data.rank = decodeInt(fields)
      contractDetails.contract.conId = decodeInt(fields) // ver 3
      contractDetails.contract.symbol = decodeStr(fields)
      contractDetails.contract.secType = decodeStr(fields)
      contractDetails.contract.lastTradeDateOrContractMonth = decodeStr(fields)
      contractDetails.contract.strike = decodeFloat(fields)
      contractDetails.contract.right = decodeStr(fields)
      contractDetails.contract.exchange = decodeStr(fields)
      contractDetails.contract.currency = decodeStr(fields)
      contractDetails.contract.localSymbol = decodeStr(fields)
      contractDetails.marketName = decodeStr(fields)
      contractDetails.contract.tradingClass = decodeStr(fields)
      data.distance = decodeStr(fields)
      data.benchmark = decodeStr(fields)
      data.projection = decodeStr(fields)
      data.legsStr = decodeStr(fields)
      this.wrapper.scannerData(
        reqId, data.rank, contractDetails,
        data.distance, data.benchmark, data.projection, data.legsStr,
      )
    }

    this.wrapper.scannerDataEnd(reqId)
  }

  private processExecutionDataMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    let version = this.serverVersion

    if (this.serverVersion < MIN_SERVER_VER_LAST_LIQUIDITY) {
      version = decodeInt(fields)
    }

    let reqId = -1
    if (version >= 7) {
      reqId = decodeInt(fields)
    }

    const orderId = decodeInt(fields)

    const contract = new Contract()
    contract.conId = decodeInt(fields) // ver 5
    contract.symbol = decodeStr(fields)
    contract.secType = decodeStr(fields)
    contract.lastTradeDateOrContractMonth = decodeStr(fields)
    contract.strike = decodeFloat(fields)
    contract.right = decodeStr(fields)
    if (version >= 9) {
      contract.multiplier = decodeStr(fields)
    }
    contract.exchange = decodeStr(fields)
    contract.currency = decodeStr(fields)
    contract.localSymbol = decodeStr(fields)
    if (version >= 10) {
      contract.tradingClass = decodeStr(fields)
    }

    const execution = new Execution()
    execution.orderId = orderId
    execution.execId = decodeStr(fields)
    execution.time = decodeStr(fields)
    execution.acctNumber = decodeStr(fields)
    execution.exchange = decodeStr(fields)
    execution.side = decodeStr(fields)
    execution.shares = decodeDecimal(fields)
    execution.price = decodeFloat(fields)
    execution.permId = decodeInt(fields) // ver 2
    execution.clientId = decodeInt(fields) // ver 3
    execution.liquidation = decodeInt(fields) // ver 4

    if (version >= 6) {
      execution.cumQty = decodeDecimal(fields)
      execution.avgPrice = decodeFloat(fields)
    }

    if (version >= 8) {
      execution.orderRef = decodeStr(fields)
    }

    if (version >= 9) {
      execution.evRule = decodeStr(fields)
      execution.evMultiplier = decodeFloat(fields)
    }
    if (this.serverVersion >= MIN_SERVER_VER_MODELS_SUPPORT) {
      execution.modelCode = decodeStr(fields)
    }
    if (this.serverVersion >= MIN_SERVER_VER_LAST_LIQUIDITY) {
      execution.lastLiquidity = decodeInt(fields)
    }
    if (this.serverVersion >= MIN_SERVER_VER_PENDING_PRICE_REVISION) {
      execution.pendingPriceRevision = decodeBool(fields)
    }
    if (this.serverVersion >= MIN_SERVER_VER_SUBMITTER) {
      execution.submitter = decodeStr(fields)
    }

    this.wrapper.execDetails(reqId, contract, execution)
  }

  private processHistoricalDataMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    if (this.serverVersion < MIN_SERVER_VER_SYNT_REALTIME_BARS) {
      decodeInt(fields) // version
    }

    const reqId = decodeInt(fields)

    let startDateStr = ''
    let endDateStr = ''
    if (this.serverVersion < MIN_SERVER_VER_HISTORICAL_DATA_END) {
      startDateStr = decodeStr(fields) // ver 2
      endDateStr = decodeStr(fields) // ver 2
    }

    const itemCount = decodeInt(fields)

    for (let i = 0; i < itemCount; i++) {
      const bar = new BarData()
      bar.date = decodeStr(fields)
      bar.open = decodeFloat(fields)
      bar.high = decodeFloat(fields)
      bar.low = decodeFloat(fields)
      bar.close = decodeFloat(fields)
      bar.volume = decodeDecimal(fields)
      bar.wap = decodeDecimal(fields)

      if (this.serverVersion < MIN_SERVER_VER_SYNT_REALTIME_BARS) {
        decodeStr(fields) // hasGaps
      }

      bar.barCount = decodeInt(fields) // ver 3

      this.wrapper.historicalData(reqId, bar)
    }

    if (this.serverVersion < MIN_SERVER_VER_HISTORICAL_DATA_END) {
      this.wrapper.historicalDataEnd(reqId, startDateStr, endDateStr)
    }
  }

  private processHistoricalDataEndMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const startDateStr = decodeStr(fields)
    const endDateStr = decodeStr(fields)

    this.wrapper.historicalDataEnd(reqId, startDateStr, endDateStr)
  }

  private processHistoricalDataUpdateMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const bar = new BarData()
    bar.barCount = decodeInt(fields)
    bar.date = decodeStr(fields)
    bar.open = decodeFloat(fields)
    bar.close = decodeFloat(fields)
    bar.high = decodeFloat(fields)
    bar.low = decodeFloat(fields)
    bar.wap = decodeDecimal(fields)
    bar.volume = decodeDecimal(fields)
    this.wrapper.historicalDataUpdate(reqId, bar)
  }

  private processRealTimeBarMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)

    const bar = new RealTimeBar()
    bar.time = decodeInt(fields)
    bar.open_ = decodeFloat(fields)
    bar.high = decodeFloat(fields)
    bar.low = decodeFloat(fields)
    bar.close = decodeFloat(fields)
    bar.volume = decodeDecimal(fields)
    bar.wap = decodeDecimal(fields)
    bar.count = decodeInt(fields)

    this.wrapper.realtimeBar(
      reqId, bar.time, bar.open_, bar.high, bar.low, bar.close,
      bar.volume, bar.wap, bar.count,
    )
  }

  private processTickOptionComputationMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    let version = this.serverVersion
    let tickAttrib = 0
    let optPrice: number | null = null
    let pvDividend: number | null = null
    let gamma: number | null = null
    let vega: number | null = null
    let theta: number | null = null
    let undPrice: number | null = null

    if (this.serverVersion < MIN_SERVER_VER_PRICE_BASED_VOLATILITY) {
      version = decodeInt(fields)
    }

    const reqId = decodeInt(fields)
    const tickTypeInt = decodeInt(fields)

    if (this.serverVersion >= MIN_SERVER_VER_PRICE_BASED_VOLATILITY) {
      tickAttrib = decodeInt(fields)
    }

    let impliedVol: number | null = decodeFloat(fields)
    let delta: number | null = decodeFloat(fields)

    if (impliedVol! < 0) impliedVol = null // -1 = not computed
    if (delta === -2) delta = null // -2 = not computed

    if (
      version >= 6 ||
      tickTypeInt === TickTypeEnum.MODEL_OPTION ||
      tickTypeInt === TickTypeEnum.DELAYED_MODEL_OPTION
    ) {
      optPrice = decodeFloat(fields)
      pvDividend = decodeFloat(fields)

      if (optPrice === -1) optPrice = null
      if (pvDividend === -1) pvDividend = null
    }

    if (version >= 6) {
      gamma = decodeFloat(fields)
      vega = decodeFloat(fields)
      theta = decodeFloat(fields)
      undPrice = decodeFloat(fields)

      if (gamma === -2) gamma = null
      if (vega === -2) vega = null
      if (theta === -2) theta = null
      if (undPrice === -1) undPrice = null
    }

    this.wrapper.tickOptionComputation(
      reqId, tickTypeInt, tickAttrib,
      impliedVol, delta, optPrice, pvDividend,
      gamma, vega, theta, undPrice,
    )
  }

  private processDeltaNeutralValidationMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)

    const deltaNeutralContract = new DeltaNeutralContract()
    deltaNeutralContract.conId = decodeInt(fields)
    deltaNeutralContract.delta = decodeFloat(fields)
    deltaNeutralContract.price = decodeFloat(fields)

    this.wrapper.deltaNeutralValidation(reqId, deltaNeutralContract)
  }

  private processCommissionAndFeesReportMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version

    const report = new CommissionAndFeesReport()
    report.execId = decodeStr(fields)
    report.commissionAndFees = decodeFloat(fields)
    report.currency = decodeStr(fields)
    report.realizedPNL = decodeFloat(fields)
    report.yield_ = decodeFloat(fields)
    report.yieldRedemptionDate = decodeInt(fields)

    this.wrapper.commissionAndFeesReport(report)
  }

  private processPositionDataMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const version = decodeInt(fields)

    const account = decodeStr(fields)

    const contract = new Contract()
    contract.conId = decodeInt(fields)
    contract.symbol = decodeStr(fields)
    contract.secType = decodeStr(fields)
    contract.lastTradeDateOrContractMonth = decodeStr(fields)
    contract.strike = decodeFloat(fields)
    contract.right = decodeStr(fields)
    contract.multiplier = decodeStr(fields)
    contract.exchange = decodeStr(fields)
    contract.currency = decodeStr(fields)
    contract.localSymbol = decodeStr(fields)
    if (version >= 2) {
      contract.tradingClass = decodeStr(fields)
    }

    const position = decodeDecimal(fields)

    let avgCost = 0.0
    if (version >= 3) {
      avgCost = decodeFloat(fields)
    }

    this.wrapper.position(account, contract, position, avgCost)
  }

  private processPositionMultiMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)
    const account = decodeStr(fields)

    const contract = new Contract()
    contract.conId = decodeInt(fields)
    contract.symbol = decodeStr(fields)
    contract.secType = decodeStr(fields)
    contract.lastTradeDateOrContractMonth = decodeStr(fields)
    contract.strike = decodeFloat(fields)
    contract.right = decodeStr(fields)
    contract.multiplier = decodeStr(fields)
    contract.exchange = decodeStr(fields)
    contract.currency = decodeStr(fields)
    contract.localSymbol = decodeStr(fields)
    contract.tradingClass = decodeStr(fields)
    const position = decodeDecimal(fields)
    const avgCost = decodeFloat(fields)
    const modelCode = decodeStr(fields)

    this.wrapper.positionMulti(reqId, account, modelCode, contract, position, avgCost)
  }

  private processSecurityDefinitionOptionParameterMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const exchange = decodeStr(fields)
    const underlyingConId = decodeInt(fields)
    const tradingClass = decodeStr(fields)
    const multiplier = decodeStr(fields)

    const expCount = decodeInt(fields)
    const expirations = new Set<string>()
    for (let i = 0; i < expCount; i++) {
      expirations.add(decodeStr(fields))
    }

    const strikeCount = decodeInt(fields)
    const strikes = new Set<number>()
    for (let i = 0; i < strikeCount; i++) {
      strikes.add(decodeFloat(fields))
    }

    this.wrapper.securityDefinitionOptionParameter(
      reqId, exchange, underlyingConId, tradingClass, multiplier,
      expirations, strikes,
    )
  }

  private processSecurityDefinitionOptionParameterEndMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    this.wrapper.securityDefinitionOptionParameterEnd(reqId)
  }

  private processSoftDollarTiersMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const nTiers = decodeInt(fields)

    const tiers: SoftDollarTier[] = []
    for (let i = 0; i < nTiers; i++) {
      const tier = new SoftDollarTier()
      tier.name = decodeStr(fields)
      tier.val = decodeStr(fields)
      tier.displayName = decodeStr(fields)
      tiers.push(tier)
    }

    this.wrapper.softDollarTiers(reqId, tiers)
  }

  private processFamilyCodesMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const nFamilyCodes = decodeInt(fields)
    const familyCodes: FamilyCode[] = []
    for (let i = 0; i < nFamilyCodes; i++) {
      const famCode = new FamilyCode()
      famCode.accountID = decodeStr(fields)
      famCode.familyCodeStr = decodeStr(fields)
      familyCodes.push(famCode)
    }

    this.wrapper.familyCodes(familyCodes)
  }

  private processSymbolSamplesMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const nContractDescriptions = decodeInt(fields)
    const contractDescriptions: ContractDescription[] = []
    for (let i = 0; i < nContractDescriptions; i++) {
      const conDesc = new ContractDescription()
      conDesc.contract.conId = decodeInt(fields)
      conDesc.contract.symbol = decodeStr(fields)
      conDesc.contract.secType = decodeStr(fields)
      conDesc.contract.primaryExchange = decodeStr(fields)
      conDesc.contract.currency = decodeStr(fields)

      const nDerivativeSecTypes = decodeInt(fields)
      conDesc.derivativeSecTypes = []
      for (let j = 0; j < nDerivativeSecTypes; j++) {
        conDesc.derivativeSecTypes.push(decodeStr(fields))
      }
      contractDescriptions.push(conDesc)

      if (this.serverVersion >= MIN_SERVER_VER_BOND_ISSUERID) {
        conDesc.contract.description = decodeStr(fields)
        conDesc.contract.issuerId = decodeStr(fields)
      }
    }

    this.wrapper.symbolSamples(reqId, contractDescriptions)
  }

  private processSmartComponents(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const n = decodeInt(fields)

    const smartComponentMap: SmartComponent[] = []
    for (let i = 0; i < n; i++) {
      const smartComponent = new SmartComponent()
      smartComponent.bitNumber = decodeInt(fields)
      smartComponent.exchange = decodeStr(fields)
      smartComponent.exchangeLetter = decodeStr(fields)
      smartComponentMap.push(smartComponent)
    }

    this.wrapper.smartComponents(reqId, smartComponentMap)
  }

  private processTickReqParams(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const tickerId = decodeInt(fields)
    const minTick = decodeFloat(fields)
    const bboExchange = decodeStr(fields)
    const snapshotPermissions = decodeInt(fields)
    this.wrapper.tickReqParams(tickerId, minTick, bboExchange, snapshotPermissions)
  }

  private processMktDepthExchanges(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const depthMktDataDescriptions: DepthMktDataDescription[] = []
    const nDepthMktDataDescriptions = decodeInt(fields)

    if (nDepthMktDataDescriptions > 0) {
      for (let i = 0; i < nDepthMktDataDescriptions; i++) {
        const desc = new DepthMktDataDescription()
        desc.exchange = decodeStr(fields)
        desc.secType = decodeStr(fields)
        if (this.serverVersion >= MIN_SERVER_VER_SERVICE_DATA_TYPE) {
          desc.listingExch = decodeStr(fields)
          desc.serviceDataType = decodeStr(fields)
          desc.aggGroup = decodeInt(fields)
        } else {
          decodeInt(fields) // boolean notSuppIsL2
        }
        depthMktDataDescriptions.push(desc)
      }
    }

    this.wrapper.mktDepthExchanges(depthMktDataDescriptions)
  }

  private processHeadTimestamp(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const headTimestamp = decodeStr(fields)
    this.wrapper.headTimestamp(reqId, headTimestamp)
  }

  private processTickNews(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const tickerId = decodeInt(fields)
    const timeStamp = decodeInt(fields)
    const providerCode = decodeStr(fields)
    const articleId = decodeStr(fields)
    const headline = decodeStr(fields)
    const extraData = decodeStr(fields)
    this.wrapper.tickNews(tickerId, timeStamp, providerCode, articleId, headline, extraData)
  }

  private processNewsProviders(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const newsProviders: NewsProvider[] = []
    const nNewsProviders = decodeInt(fields)
    if (nNewsProviders > 0) {
      for (let i = 0; i < nNewsProviders; i++) {
        const provider = new NewsProvider()
        provider.code = decodeStr(fields)
        provider.name = decodeStr(fields)
        newsProviders.push(provider)
      }
    }

    this.wrapper.newsProviders(newsProviders)
  }

  private processNewsArticle(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const articleType = decodeInt(fields)
    const articleText = decodeStr(fields)
    this.wrapper.newsArticle(reqId, articleType, articleText)
  }

  private processHistoricalNews(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const requestId = decodeInt(fields)
    const time = decodeStr(fields)
    const providerCode = decodeStr(fields)
    const articleId = decodeStr(fields)
    const headline = decodeStr(fields)
    this.wrapper.historicalNews(requestId, time, providerCode, articleId, headline)
  }

  private processHistoricalNewsEnd(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const hasMore = decodeBool(fields)
    this.wrapper.historicalNewsEnd(reqId, hasMore)
  }

  private processHistogramData(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const numPoints = decodeInt(fields)

    const histogram: HistogramData[] = []
    for (let i = 0; i < numPoints; i++) {
      const dataPoint = new HistogramData()
      dataPoint.price = decodeFloat(fields)
      dataPoint.size = decodeDecimal(fields)
      histogram.push(dataPoint)
    }

    this.wrapper.histogramData(reqId, histogram)
  }

  private processRerouteMktDataReq(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const conId = decodeInt(fields)
    const exchange = decodeStr(fields)
    this.wrapper.rerouteMktDataReq(reqId, conId, exchange)
  }

  private processRerouteMktDepthReq(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const conId = decodeInt(fields)
    const exchange = decodeStr(fields)
    this.wrapper.rerouteMktDepthReq(reqId, conId, exchange)
  }

  private processMarketRuleMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const marketRuleId = decodeInt(fields)

    const nPriceIncrements = decodeInt(fields)
    const priceIncrements: PriceIncrement[] = []

    if (nPriceIncrements > 0) {
      for (let i = 0; i < nPriceIncrements; i++) {
        const prcInc = new PriceIncrement()
        prcInc.lowEdge = decodeFloat(fields)
        prcInc.increment = decodeFloat(fields)
        priceIncrements.push(prcInc)
      }
    }

    this.wrapper.marketRule(marketRuleId, priceIncrements)
  }

  private processPnLMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const dailyPnL = decodeFloat(fields)
    let unrealizedPnL: number | null = null
    let realizedPnL: number | null = null

    if (this.serverVersion >= MIN_SERVER_VER_UNREALIZED_PNL) {
      unrealizedPnL = decodeFloat(fields)
    }

    if (this.serverVersion >= MIN_SERVER_VER_REALIZED_PNL) {
      realizedPnL = decodeFloat(fields)
    }

    this.wrapper.pnl(reqId, dailyPnL, unrealizedPnL, realizedPnL)
  }

  private processPnLSingleMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const pos = decodeDecimal(fields)
    const dailyPnL = decodeFloat(fields)
    let unrealizedPnL: number | null = null
    let realizedPnL: number | null = null

    if (this.serverVersion >= MIN_SERVER_VER_UNREALIZED_PNL) {
      unrealizedPnL = decodeFloat(fields)
    }

    if (this.serverVersion >= MIN_SERVER_VER_REALIZED_PNL) {
      realizedPnL = decodeFloat(fields)
    }

    const value = decodeFloat(fields)

    this.wrapper.pnlSingle(reqId, pos, dailyPnL, unrealizedPnL, realizedPnL, value)
  }

  private processHistoricalTicks(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const tickCount = decodeInt(fields)

    const ticks: HistoricalTick[] = []

    for (let i = 0; i < tickCount; i++) {
      const historicalTick = new HistoricalTick()
      historicalTick.time = decodeInt(fields)
      fields.next() // skip for consistency
      historicalTick.price = decodeFloat(fields)
      historicalTick.size = decodeDecimal(fields)
      ticks.push(historicalTick)
    }

    const done = decodeBool(fields)

    this.wrapper.historicalTicks(reqId, ticks, done)
  }

  private processHistoricalTicksBidAsk(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const tickCount = decodeInt(fields)

    const ticks: HistoricalTickBidAsk[] = []

    for (let i = 0; i < tickCount; i++) {
      const historicalTickBidAsk = new HistoricalTickBidAsk()
      historicalTickBidAsk.time = decodeInt(fields)
      const mask = decodeInt(fields)
      const tickAttribBidAsk = new TickAttribBidAsk()
      tickAttribBidAsk.askPastHigh = (mask & 1) !== 0
      tickAttribBidAsk.bidPastLow = (mask & 2) !== 0
      historicalTickBidAsk.tickAttribBidAsk = tickAttribBidAsk
      historicalTickBidAsk.priceBid = decodeFloat(fields)
      historicalTickBidAsk.priceAsk = decodeFloat(fields)
      historicalTickBidAsk.sizeBid = decodeDecimal(fields)
      historicalTickBidAsk.sizeAsk = decodeDecimal(fields)
      ticks.push(historicalTickBidAsk)
    }

    const done = decodeBool(fields)

    this.wrapper.historicalTicksBidAsk(reqId, ticks, done)
  }

  private processHistoricalTicksLast(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const tickCount = decodeInt(fields)

    const ticks: HistoricalTickLast[] = []

    for (let i = 0; i < tickCount; i++) {
      const historicalTickLast = new HistoricalTickLast()
      historicalTickLast.time = decodeInt(fields)
      const mask = decodeInt(fields)
      const tickAttribLast = new TickAttribLast()
      tickAttribLast.pastLimit = (mask & 1) !== 0
      tickAttribLast.unreported = (mask & 2) !== 0
      historicalTickLast.tickAttribLast = tickAttribLast
      historicalTickLast.price = decodeFloat(fields)
      historicalTickLast.size = decodeDecimal(fields)
      historicalTickLast.exchange = decodeStr(fields)
      historicalTickLast.specialConditions = decodeStr(fields)
      ticks.push(historicalTickLast)
    }

    const done = decodeBool(fields)

    this.wrapper.historicalTicksLast(reqId, ticks, done)
  }

  private processTickByTickMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const tickType = decodeInt(fields)
    const time = decodeInt(fields)

    if (tickType === 0) {
      // None
    } else if (tickType === 1 || tickType === 2) {
      // Last or AllLast
      const price = decodeFloat(fields)
      const size = decodeDecimal(fields)
      const mask = decodeInt(fields)

      const tickAttribLast = new TickAttribLast()
      tickAttribLast.pastLimit = (mask & 1) !== 0
      tickAttribLast.unreported = (mask & 2) !== 0
      const exchange = decodeStr(fields)
      const specialConditions = decodeStr(fields)

      this.wrapper.tickByTickAllLast(
        reqId, tickType, time, price, size,
        tickAttribLast, exchange, specialConditions,
      )
    } else if (tickType === 3) {
      // BidAsk
      const bidPrice = decodeFloat(fields)
      const askPrice = decodeFloat(fields)
      const bidSize = decodeDecimal(fields)
      const askSize = decodeDecimal(fields)
      const mask = decodeInt(fields)
      const tickAttribBidAsk = new TickAttribBidAsk()
      tickAttribBidAsk.bidPastLow = (mask & 1) !== 0
      tickAttribBidAsk.askPastHigh = (mask & 2) !== 0

      this.wrapper.tickByTickBidAsk(
        reqId, time, bidPrice, askPrice, bidSize, askSize, tickAttribBidAsk,
      )
    } else if (tickType === 4) {
      // MidPoint
      const midPoint = decodeFloat(fields)
      this.wrapper.tickByTickMidPoint(reqId, time, midPoint)
    }
  }

  private processOrderBoundMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const permId = decodeInt(fields)
    const clientId = decodeInt(fields)
    const orderId = decodeInt(fields)

    this.wrapper.orderBound(permId, clientId, orderId)
  }

  private processMarketDepthMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)

    const position = decodeInt(fields)
    const operation = decodeInt(fields)
    const side = decodeInt(fields)
    const price = decodeFloat(fields)
    const size = decodeDecimal(fields)

    this.wrapper.updateMktDepth(reqId, position, operation, side, price, size)
  }

  private processMarketDepthL2Msg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    decodeInt(fields) // version
    const reqId = decodeInt(fields)

    const position = decodeInt(fields)
    const marketMaker = decodeStr(fields)
    const operation = decodeInt(fields)
    const side = decodeInt(fields)
    const price = decodeFloat(fields)
    const size = decodeDecimal(fields)
    let isSmartDepth = false

    if (this.serverVersion >= MIN_SERVER_VER_SMART_DEPTH) {
      isSmartDepth = decodeBool(fields)
    }

    this.wrapper.updateMktDepthL2(
      reqId, position, marketMaker, operation, side, price, size, isSmartDepth,
    )
  }

  private processCompletedOrderMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId

    const order = new Order()
    const contract = new Contract()
    const orderState = new OrderState()

    const od = new OrderDecoder(contract, order, orderState, UNSET_INTEGER, this.serverVersion)

    od.decodeContractFields(fields)
    od.decodeAction(fields)
    od.decodeTotalQuantity(fields)
    od.decodeOrderType(fields)
    od.decodeLmtPrice(fields)
    od.decodeAuxPrice(fields)
    od.decodeTIF(fields)
    od.decodeOcaGroup(fields)
    od.decodeAccount(fields)
    od.decodeOpenClose(fields)
    od.decodeOrigin(fields)
    od.decodeOrderRef(fields)
    od.decodePermId(fields)
    od.decodeOutsideRth(fields)
    od.decodeHidden(fields)
    od.decodeDiscretionaryAmt(fields)
    od.decodeGoodAfterTime(fields)
    od.decodeFAParams(fields)
    od.decodeModelCode(fields)
    od.decodeGoodTillDate(fields)
    od.decodeRule80A(fields)
    od.decodePercentOffset(fields)
    od.decodeSettlingFirm(fields)
    od.decodeShortSaleParams(fields)
    od.decodeBoxOrderParams(fields)
    od.decodePegToStkOrVolOrderParams(fields)
    od.decodeDisplaySize(fields)
    od.decodeSweepToFill(fields)
    od.decodeAllOrNone(fields)
    od.decodeMinQty(fields)
    od.decodeOcaType(fields)
    od.decodeTriggerMethod(fields)
    od.decodeVolOrderParams(fields, false)
    od.decodeTrailParams(fields)
    od.decodeComboLegs(fields)
    od.decodeSmartComboRoutingParams(fields)
    od.decodeScaleOrderParams(fields)
    od.decodeHedgeParams(fields)
    od.decodeClearingParams(fields)
    od.decodeNotHeld(fields)
    od.decodeDeltaNeutral(fields)
    od.decodeAlgoParams(fields)
    od.decodeSolicited(fields)
    od.decodeOrderStatus(fields)
    od.decodeVolRandomizeFlags(fields)
    od.decodePegToBenchParams(fields)
    od.decodeConditions(fields)
    od.decodeStopPriceAndLmtPriceOffset(fields)
    od.decodeCashQty(fields)
    od.decodeDontUseAutoPriceForHedge(fields)
    od.decodeIsOmsContainers(fields)
    od.decodeAutoCancelDate(fields)
    od.decodeFilledQuantity(fields)
    od.decodeRefFuturesConId(fields)
    od.decodeAutoCancelParent(fields)
    od.decodeShareholder(fields)
    od.decodeImbalanceOnly(fields)
    od.decodeRouteMarketableToBbo(fields)
    od.decodeParentPermId(fields)
    od.decodeCompletedTime(fields)
    od.decodeCompletedStatus(fields)
    od.decodePegBestPegMidOrderAttributes(fields)
    od.decodeCustomerAccount(fields)
    od.decodeProfessionalCustomer(fields)
    od.decodeSubmitter(fields)

    this.wrapper.completedOrder(contract, order, orderState)
  }

  private processCompletedOrdersEndMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    this.wrapper.completedOrdersEnd()
  }

  private processReplaceFAEndMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const text = decodeStr(fields)
    this.wrapper.replaceFAEnd(reqId, text)
  }

  private processWshMetaDataMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const dataJson = decodeStr(fields)
    this.wrapper.wshMetaData(reqId, dataJson)
  }

  private processWshEventDataMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const dataJson = decodeStr(fields)
    this.wrapper.wshEventData(reqId, dataJson)
  }

  private processHistoricalSchedule(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const startDateTime = decodeStr(fields)
    const endDateTime = decodeStr(fields)
    const timeZone = decodeStr(fields)
    const sessionsCount = decodeInt(fields)

    const sessions: HistoricalSession[] = []

    for (let i = 0; i < sessionsCount; i++) {
      const historicalSession = new HistoricalSession()
      historicalSession.startDateTime = decodeStr(fields)
      historicalSession.endDateTime = decodeStr(fields)
      historicalSession.refDate = decodeStr(fields)
      sessions.push(historicalSession)
    }

    this.wrapper.historicalSchedule(reqId, startDateTime, endDateTime, timeZone, sessions)
  }

  private processUserInfo(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const reqId = decodeInt(fields)
    const whiteBrandingId = decodeStr(fields)
    this.wrapper.userInfo(reqId, whiteBrandingId)
  }

  private processCurrentTimeInMillis(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    const timeInMillis = decodeInt(fields)
    this.wrapper.currentTimeInMillis(timeInMillis)
  }

  private processErrorMsg(fields: Iterator<string>): void {
    decodeInt(fields) // msgId
    if (this.serverVersion < MIN_SERVER_VER_ERROR_TIME) {
      decodeInt(fields) // version
    }
    const reqId = decodeInt(fields)
    const errorCode = decodeInt(fields)
    const errorString = decodeStr(fields)
    let advancedOrderRejectJson = ''
    if (this.serverVersion >= MIN_SERVER_VER_ADVANCED_ORDER_REJECT) {
      advancedOrderRejectJson = decodeStr(fields)
    }
    let errorTime = 0
    if (this.serverVersion >= MIN_SERVER_VER_ERROR_TIME) {
      errorTime = decodeInt(fields)
    }

    this.wrapper.error(reqId, errorTime, errorCode, errorString, advancedOrderRejectJson)
  }

  // ----------------------------------------------------------------
  // Helper
  // ----------------------------------------------------------------

  private readLastTradeDate(fields: Iterator<string>, contract: ContractDetails, isBond: boolean): void {
    const lastTradeDateOrContractMonth = decodeStr(fields)
    setLastTradeDate(lastTradeDateOrContractMonth, contract, isBond)
  }
}
