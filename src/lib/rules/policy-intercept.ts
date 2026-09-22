import type {
  CanonicalContent,
  ModelReview,
  ModelRuleResult,
} from "@/lib/schemas/review";

const absoluteEffect = /(?:100\s*%|百分之百)\s*(?:有效|见效)/i;
const statisticalSignal = /(?:用户|销量|增长|提升|调研|样本|订单|购买|人数|件)/;
const numericDataClaim =
  /(?:\d+(?:\.\d+)?\s*%|百分之[一二三四五六七八九十百千万零〇\d]+|\d+(?:万|千)?\s*(?:用户|销量|订单|购买|样本|件|人)|(?:用户|销量|订单|购买|样本|增长|提升)\s*\d+)/;
const explicitEffectClaim =
  /(?:改善|提亮|焕亮|淡斑|祛痘|去痘|修护|保湿|水润|细腻|透亮|亮白|焕白)(?:肤色|肌肤|皮肤|暗沉|毛孔|痘痘|屏障|状态)|(?:治疗|治愈|根治).{0,6}(?:痘|病|肌肤|皮肤)?|(?:保证|7\s*天|\d+\s*天).{0,8}(?:见效|改善|焕亮|提亮|淡斑|祛痘)|(?:温和|深层|强效|高效).{0,5}(?:有效|修护|净痘|洁净)/;
const competitorComparison =
  /(?:竞品|同类|其他品牌|友商|对手|比.{0,8}(?:好|强|优)|领先|优于|胜过)/;
const promotionSignal =
  /(?:\d+\s*折|满\s*\d+\s*减\s*\d+|买\s*\d*\s*送\s*\d*|赠品|优惠|会员日)/;
const dateRange =
  /(?:\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}\s*月\s*\d{1,2}\s*日|活动时间|起止日期)/;
const channelOrScope =
  /(?:官方|小程序|门店|线上|app|平台|指定商品|指定产品|适用)/i;
const limitation =
  /(?:每.{0,5}限|限.{0,8}(?:次|件|份|量)|不.{0,5}叠加|不可.{0,5}叠加|数量有限|售完即止)/;
const sensitiveOnly =
  /(?:治疗|治愈|根治|无副作用|零风险|无风险|稳赚|保本稳赚|只赚不赔)/;
const independentAbsolute = /(?:最佳|第一|唯一|100\s*%|百分之百)/;
const endorsementSignal =
  /(?:专家|医生|机构|推荐|好评|评价|见证|顾问|认证|背书)/;
const dataEvidence =
  /(?:数据来源|来源[：:]|样本|统计期|统计范围|测试条件|测试报告|报告编号|实验室)/;
const endorsementEvidence = /(?:身份[：:]|授权编号|授权有效期|使用授权|授权至)/;

function findRule(review: ModelReview, ruleId: ModelRuleResult["ruleId"]) {
  return review.ruleResults.find((item) => item.ruleId === ruleId)!;
}

function setRisk(
  rule: ModelRuleResult,
  evidence: string,
  reason: string,
  suggestion: string,
) {
  rule.status = "RISK";
  rule.evidence = [...new Set([...rule.evidence, evidence])];
  rule.reason = reason;
  rule.suggestion = suggestion;
  rule.missingInformation = [];
}

function setPass(rule: ModelRuleResult, reason: string) {
  rule.status = "PASS";
  rule.evidence = [];
  rule.reason = reason;
  rule.suggestion = null;
  rule.missingInformation = [];
}

/**
 * Small, auditable policy corrections for highly ambiguous surface forms. They
 * run after model reasoning and before Validator so the rule registry remains
 * the source of truth while common false positives stay deterministic.
 */
export function enforceRulePolicy(
  review: ModelReview,
  canonical: CanonicalContent,
): ModelReview {
  const text = canonical.extractedTextSegments
    .map((segment) => segment.text)
    .join("\n");
  const normalized = text.match(absoluteEffect)?.[0];
  const result: ModelReview = {
    ruleResults: review.ruleResults.map((item) => ({
      ...item,
      evidence: [...item.evidence],
      missingInformation: [...item.missingInformation],
    })),
  };

  if (normalized) {
    const a01 = findRule(result, "A-01");
    const a05 = findRule(result, "A-05");
    setRisk(
      a01,
      normalized,
      "“100%有效”属于无法由当前材料证明的绝对化效果表述。",
      "删除确定性承诺，或改为有明确依据支持的限定性表达。",
    );
    setRisk(
      a05,
      normalized,
      "“100%有效”对使用效果作出了确定性保证，当前材料未提供可验证依据。",
      "避免保证所有用户获得相同效果，改为不作确定性承诺的表述。",
    );

    const a02 = findRule(result, "A-02");
    const a02Evidence = a02.evidence.join(" ");
    if (
      !statisticalSignal.test(a02Evidence.replace(normalized, "")) &&
      !statisticalSignal.test(text.replace(normalized, ""))
    ) {
      a02.status = "PASS";
      a02.evidence = [];
      a02.reason = "“100%有效”是绝对化效果表述，不作为统计数据宣传处理。";
      a02.suggestion = null;
      a02.missingInformation = [];
    }
  }

  // A-02 covers statistical claims, not every ranking adjective. This keeps
  // A-01's "第一/唯一" wording from being duplicated as a data violation.
  if (!numericDataClaim.test(text)) {
    setPass(
      findRule(result, "A-02"),
      "当前材料未发现百分比、数量、销量或增长等宣传性统计数据。",
    );
  }
  if (numericDataClaim.test(text) && dataEvidence.test(text)) {
    setPass(
      findRule(result, "A-02"),
      "当前统计或比较数据具有可识别的来源、测试条件、口径或报告信息。",
    );
  }

  // A product name or an abstract positive word is not itself an A-05 effect
  // promise. The model still evaluates clear effect claims; this guard only
  // removes a reported A-05 hit when no defined effect form exists in text.
  if (!normalized && !explicitEffectClaim.test(text)) {
    setPass(
      findRule(result, "A-05"),
      "当前材料未发现明确的健康、美容、性能或收益效果承诺。",
    );
  }

  // A-07 needs an actual competitor or comparative frame. Absolute wording
  // without one remains an A-01 issue rather than an invented comparison.
  if (!competitorComparison.test(text)) {
    setPass(
      findRule(result, "A-07"),
      "当前材料未发现竞品贬损或全面优越比较的明确语境。",
    );
  }

  const offer = text.match(promotionSignal)?.[0];
  if (offer) {
    const a03 = findRule(result, "A-03");
    const a04 = findRule(result, "A-04");
    if (!dateRange.test(text)) {
      setRisk(
        a03,
        offer,
        "存在优惠活动，但当前材料未见明确可识别的起止日期。",
        "补充活动开始日期与结束日期。",
      );
    }
    if (
      dateRange.test(text) &&
      (!channelOrScope.test(text) || !limitation.test(text))
    ) {
      setRisk(
        a04,
        offer,
        "优惠活动已出现，但适用范围、渠道或主要限制条件披露不完整。",
        "补充适用商品或渠道、数量或次数限制，以及是否可与其他优惠叠加。",
      );
    }
  }

  // The A-06 lexicon is an explicit intercept. Do not duplicate a material
  // containing only that lexicon as A-01 unless it also has independent
  // absolute wording such as “第一” or “100%”.
  if (sensitiveOnly.test(text) && !independentAbsolute.test(text)) {
    setPass(
      findRule(result, "A-01"),
      "当前绝对性表述属于 A-06 已定义的敏感词拦截范围，不重复记为 A-01。",
    );
  }
  if (/保证见效/.test(text) && !independentAbsolute.test(text)) {
    setPass(
      findRule(result, "A-01"),
      "“保证见效”作为效果承诺由 A-05 处理，不重复记为 A-01。",
    );
  }
  if (competitorComparison.test(text) && !independentAbsolute.test(text)) {
    setPass(
      findRule(result, "A-01"),
      "比较语境中的“好/领先”等表述由 A-07 对比贬损规则处理，不重复记为 A-01。",
    );
  }

  // A survey percentage is governed by A-02, not automatically a user
  // testimonial. A-09 only opens when the material actually presents an
  // endorsement, evaluation or authority claim.
  if (!endorsementSignal.test(text)) {
    setPass(
      findRule(result, "A-09"),
      "当前材料未发现用户评价、专家推荐或机构背书等 A-09 关注内容。",
    );
  }
  if (endorsementSignal.test(text) && endorsementEvidence.test(text)) {
    setPass(
      findRule(result, "A-09"),
      "当前背书或顾问信息具有可识别的身份与授权依据。",
    );
  }

  // A-08 does not guess undisclosed costs. If a zero-price offer explicitly
  // states its fee type and amount, it is not an A-08 violation; legibility is
  // still handled independently by A-10.
  const hasFreeClaim = /(?:0\s*元|零元|免费)\s*(?:试用|领取|体验|购|拿)?/i.test(
    text,
  );
  const hasFeeClue = /(?:押金|运费|邮费|自动续费|续费|服务费|月费|会员费)/.test(
    text,
  );
  const hasFeeAmount =
    /(?:[¥￥]\s*\d|\d+(?:\.\d+)?\s*元|每月\s*\d|\d+(?:\.\d+)?\s*\/\s*月)/.test(
      text,
    );
  if (hasFreeClaim && !hasFeeClue) {
    setPass(
      findRule(result, "A-08"),
      "素材出现免费或 0 元表述，但未出现押金、运费、自动续费等费用线索；不臆测隐藏费用。",
    );
  }
  if (hasFreeClaim && hasFeeClue && hasFeeAmount) {
    setPass(
      findRule(result, "A-08"),
      "素材已同时披露费用类型与金额，当前材料未发现 A-08 所述的费用未披露风险。",
    );
  }
  if (hasFreeClaim && !promotionSignal.test(text)) {
    setPass(
      findRule(result, "A-03"),
      "当前材料是免费试用或领取信息，未出现折扣、满减、赠品等 A-03 优惠活动。",
    );
    setPass(
      findRule(result, "A-04"),
      "当前材料是免费试用或领取信息，未出现折扣、满减、赠品等 A-04 优惠活动。",
    );
  }
  if (canonical.isMaterialComplete === true) {
    setPass(
      findRule(result, "A-10"),
      "素材页面完整，未发现影响 A-01 至 A-09 判断的关键内容缺失。",
    );
  }
  return result;
}
