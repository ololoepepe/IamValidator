//The main validator module
const _ = require('underscore');
const Type = require('type-of-is');
const IamValidatorError = require('./iamvalidator-error');

const CODES = IamValidatorError.CODES;

function _createPath(arrayMode, segment = '_root', path = null) {
  if (arrayMode) {
    return path ? [...path, segment] : [segment];
  }

  return path ? `${path}.${segment}` : segment;
}

/**
 * Tests number to be in range, specified in template
 * @param {object} TEMPLATE template that optionally contains the range (min and/or/nor max fields)
 * @param {number} data the testing number
 * @return {boolean} result of testing:
 * true - the number in specified range,
 * false - the number is out of bounds
 * @private
 */
function _testMinMax(TEMPLATE, data) {
  return ((typeof TEMPLATE.min !== 'number') || (data >= TEMPLATE.min)) &&
    ((typeof TEMPLATE.max !== 'number') || (data <= TEMPLATE.max));
}

/**
 * Tests object to have specified 'length' field value
 * @param {object} TEMPLATE template that optionally contains the length,
 * @param {object} data the testing object
 * @return {boolean} result of testing:
 * true - the number has specified 'length' field value,
 * false - the number doesn't have specified length field value
 * @private
 */
function _testLength(TEMPLATE, data) {
  return ((typeof TEMPLATE.length !== 'number') || (data.length === TEMPLATE.length));
}

/**
 * Tests object to have specified 'length' field value and/or/nor 'length' field value in specified range
 * @param {object} TEMPLATE template that optionally contains the length, the min, the max
 * @param {number} data the testing object
 * @param {string} path path to the object in parent
 * @return {boolean} result of testing:
 * true - the number has specified 'length' field value,
 * false - the number doesn't have specified length field value
 * @private
 * @throws IamValidatorError
 */
function _testLengthFull(TEMPLATE, data, path) {
  let errorCode = TEMPLATE.errorCode || CODES.INVALID_LENGTH;

  if (!_testLength(TEMPLATE, data)) {
    throw new IamValidatorError(errorCode, {
      path: path,
      src: data,
      length: data.length,
      expectedLength: TEMPLATE.length
    });
  }

  if (!_testMinMax(TEMPLATE, data.length)) {
    throw new IamValidatorError(errorCode, {
      path: path,
      src: data,
      length: data.length,
      expectedMin: TEMPLATE.min,
      expectedMax: TEMPLATE.max
    });
  }
}

/**
 * Generates object with fields that template doesn't contain, but data does.
 * @param {object} TEMPLATE template
 * @param {object} data the testing object
 * @param {string} path path to the object in parent
 * @param {string} ignoreExtra doesn't throw error if extra fields found
 * @return {boolean} object containing extra fields
 * @throws IamValidatorError
 */
function getExtraData(TEMPLATE, data, path, { ignoreExtra } = {}) {
  let extraData = _(data).pick((_1, name) => !TEMPLATE.fields.hasOwnProperty(name));
  if (!ignoreExtra && ('ignore' !== TEMPLATE.extra) && (_(extraData).size() > 0)) {
    throw new IamValidatorError(CODES.EXTRA_FIELDS, {
      path: path,
      fields: _(extraData).map((_1, name) => name)
    });
  }
  return extraData;
}

/**
 * Generates object with default values from template recursively
 * @param {object} TEMPLATE template
 * @param {string} path path to the object in parent
 * @param {object} options options for validation
 * @return {*} default value
 */
function getDefaults(TEMPLATE, path, options = {}) {
  let defaults = undefined;
  switch (TEMPLATE.type) {
    case 'array':
      defaults = [];
      break;
    case 'object':
      defaults = _(TEMPLATE.fields).mapObject((field, name) => {
        return getDefaults(field, _createPath(options.arrayPathMode, name, path));
      });
      defaults = _(defaults).pick((_1, value) => { //filter fields with ('ignore' === TEMPLATE.missing)
        return typeof value !== 'undefined';
      });
      break;
    default:
      if ('default' !== TEMPLATE.missing || typeof TEMPLATE.default === 'undefined') {
        throw new IamValidatorError(CODES.MISSING_DEFAULT_FIELD, { path: path });
      }
      defaults = TEMPLATE.default;
  }
  let transformAfter = TEMPLATE.transform || TEMPLATE.transformAfter;
  if (typeof transformAfter === 'function') {
    defaults = transformAfter.call(TEMPLATE, defaults);
  }
  return defaults;
}

/**
 * Validates object field recursively
 * @param {object} data the testing field
 * @param {string} path path to the field in parent
 * @param {object} options options for validation
 * @param {any} rootData root validated object
 * @param {object} context global validation context
 * @param {*} TEMPLATE the tesing field template
 * @param {*} name the tesing field name
 * @return {*} validated field (with defaults)
 * @throws IamValidatorError
 */
function validateObjectField(data, path, options, rootData, context, TEMPLATE, name) {
  let fieldPath = _createPath(options.arrayPathMode, name, path);
  //NOTE: Object's prototype may be null, causing it to not have hasOwnProperty method
  if (Object.prototype.hasOwnProperty.call(data, name)) {
    return validate(TEMPLATE, data[name], fieldPath, options, rootData, context);
  }
  if (options.ignoreMissing) {
    return;
  }
  switch (TEMPLATE.missing) {
    case 'ignore':
      break;
    case 'default':
      return getDefaults(TEMPLATE, fieldPath, options);
    default:
      throw new IamValidatorError(CODES.MISSING_FIELD, { path: fieldPath });
  }
}

/**
 * Validates object recursively
 * @param {object} TEMPLATE template
 * @param {object} data the testing object
 * @param {string} path path to the object in parent
 * @param {object} options options for validation
 * @param {any} rootData root validated object
 * @param {object} context global validation context
 * @return {*} validated object (with defaults)
 * @throws IamValidatorError
 */
function validateObject(TEMPLATE, data, path, options, rootData, context) {
  let extraData = getExtraData(TEMPLATE, data, path, options);
  let newData = _(TEMPLATE.fields).mapObject(validateObjectField.bind(null, data, path, options, rootData, context));
  newData = _(newData).pick((value) => {
    return typeof value !== 'undefined';
  });
  return _.extend(newData, extraData);
}

/**
 * Validates array recursively
 * @param {object} TEMPLATE template
 * @param {array} data the testing array
 * @param {string} path path to the array in parent
 * @param {object} options options for validation
 * @param {any} rootData root validated object
 * @param {object} context global validation context
 * @return {array} source array (with defaults)
 * @throws IamValidatorError
 */
function validateArray(TEMPLATE, data, path, options, rootData, context) {
  _testLengthFull(TEMPLATE, data, path);
  if (!TEMPLATE.element) {
    throw new IamValidatorError(CODES.ELEMENT_NOT_SPECIFIED, { path: path });
  }
  if (TEMPLATE.element === "ignore") {
    return data;
  }
  return data.map((item, index) => {
    return validate(
      TEMPLATE.element,
      item,
      _createPath(options.arrayPathMode, index, path),
      options,
      rootData,
      context
    );
  });
}

/**
 * Validates string
 * @param {object} TEMPLATE template
 * @param {object} data the testing string
 * @param {string} path path to the string in parent
 * @return {string} source string
 * @throws IamValidatorError
 */
function validateString(TEMPLATE, data, path) {
  let errorCode = TEMPLATE.errorCode || CODES.INVALID_STRING;
  _testLengthFull(TEMPLATE, data, path);
  if (((TEMPLATE.regexp instanceof RegExp) && (!TEMPLATE.regexp.test(data)))) {
    throw new IamValidatorError(errorCode, {
      path: path,
      src: data
    });
  }
  return data;
}

/**
 * Tests number to be in range, specified in template
 * @param {object} TEMPLATE template that optionally contains the range (min and/or/nor max fields)
 * @param {number} data the testing number
 * @param {string} path path to the number in parent
 * @return {number} source number
 * @throws IamValidatorError
 */
function validateNumber(TEMPLATE, data, path) {
  let errorCode = TEMPLATE.errorCode || CODES.INVALID_NUMBER_RANGE;

  if (!_testMinMax(TEMPLATE, data)) {
    throw new IamValidatorError(errorCode, {
      path: path,
      src: data
    });
  }

  return data;
}

/**
 * Dummy validation for some types
 * @param {object} _1 Unused template
 * @param {*} data source data to be 'validated'
 * @return {*} source data
 */
function dummy(_1, data) {
  return data;
}

/**
 * Validators by type
 * @type {Map}
 */
const VALIDATORS = new Map([
  ['object', validateObject],
  ['array', validateArray],
  ['string', validateString],
  ['number', validateNumber],
  ['null', dummy],
  ['boolean', dummy],
  ['date', dummy]
]);

/**
 * Returns a list of validation templates sorted according to hint function results
 * @param {array} variants template variants
 * @param {any} data raw data to test with hint methods
 * @param {boolean} hintStrict if true, the first variant with hint function matching rawData is returned
 * @return {array|any} list of templates sorted according to hint function results
 */
function sortedVariants(variants, data, hintStrict) {
  const list = variants.slice(0)
    .map(variant => {
      const isFunction = typeof variant.hint === 'function';
      const matchesHint = isFunction ? Number(Boolean(variant.hint(data))) : 0;

      return {variant, matchesHint};
    })
    .sort((v1, v2) => v2.matchesHint - v1.matchesHint);

  if (hintStrict) {
    const variant = list.find(({matchesHint}) => matchesHint);

    if (variant) {
      return variant.variant;
    }
  }

  return list.map(({variant}) => variant);
}

/**
 * Validates data recursively
 * @param {object} TEMPLATE template
 * @param {array} data the testing data
 * @param {string} path path to the data in parent
 * @param {object} options options for validation
 * @param {any} rootData root validated object
 * @param {object} context global validation context
 * @return {array} source data (with defaults)
 * @throws IamValidatorError
 */
function validateInternal(TEMPLATE, data, path, options, rootData, context) {
  if (typeof TEMPLATE.transformBefore === 'function') {
    data = TEMPLATE.transformBefore(data);
  }

  const isPrototypeType = typeof TEMPLATE.type === 'function';

  const type = isPrototypeType ? Type.of(data) : Type.string(data).toLowerCase();

  if (isPrototypeType) {
    if (Type.of(data) !== TEMPLATE.type) {
      throw new IamValidatorError(CODES.TYPE_MISMATCH, {
        path: path,
        type: type,
        expectedType: TEMPLATE.type
      });
    }
  } else {
    if (type === "null" && TEMPLATE.type !== "null") {
      if (TEMPLATE.isNullable === true) {
        return data;
      }
      let errorCode = TEMPLATE.errorCode || CODES.UNALLOWED_NULL;
      throw new IamValidatorError(errorCode, {
        path: path,
        src: data
      });
    }

    if (type !== TEMPLATE.type) {
      throw new IamValidatorError(CODES.TYPE_MISMATCH, {
        path: path,
        type: type,
        expectedType: TEMPLATE.type
      });
    }
  }

  let validator = VALIDATORS.get(type) || (isPrototypeType && validateObject);
  if (!validator) {
    throw new IamValidatorError(CODES.NO_VALIDATOR, { path: path });
  }

  if (TEMPLATE.values instanceof Set) {
    if (!TEMPLATE.values.has(data)) {
      throw new IamValidatorError(TEMPLATE.errorCode || CODES.NOT_IN_VALUES, { path: path, src: data });
    }
  } else if (Array.isArray(TEMPLATE.values)) {
    const inValues = _.any(TEMPLATE.values, elem => {
      return _.isEqual(elem, data);
    });

    if (!inValues) {
      throw new IamValidatorError(TEMPLATE.errorCode || CODES.NOT_IN_VALUES, { path: path, src: data });
    }
  }

  if (typeof TEMPLATE.validateBefore === 'function') {
    TEMPLATE.validateBefore(data, path, options, TEMPLATE, rootData, context);
  }

  let newData = validator(TEMPLATE, data, path, options, rootData, context);

  const validateAfter = TEMPLATE.validateAfter || TEMPLATE.validate;

  if (typeof validateAfter === 'function') {
    validateAfter.call(TEMPLATE, newData, path, options, TEMPLATE, rootData, context);
  }

  let transformAfter = TEMPLATE.transform || TEMPLATE.transformAfter;
  if (typeof transformAfter === 'function') {
    newData = transformAfter.call(TEMPLATE, newData);
  }

  return newData;
}

/**
 * Validates data recursively
 * @param {object|object[]} TEMPLATE template or array of templates
 * @param {array} data the testing data
 * @param {string} path path to the data in parent
 * @param {object} options options for validation
 * @param {any} rootData root validated object
 * @param {object} context global validation context
 * @return {array} source data (with defaults)
 * @throws IamValidatorError
 */
function validate(TEMPLATE, data, path, options, rootData, context = {}) {
  const isArray = Array.isArray(TEMPLATE);

  if (isArray || (TEMPLATE.type === 'variant')) {
    const variants = sortedVariants(isArray ? TEMPLATE : TEMPLATE.variants, data, TEMPLATE.hintStrict);

    if (!Array.isArray(variants)) {
      return validateInternal(variants, data, path, options, rootData, context);
    }

    for (let i = 0; i < variants.length - 1; ++i) {
      try {
        return validateInternal(variants[i], data, path, options, rootData, context);
      } catch (err) {
        //
      }
    }
    return validateInternal(variants[variants.length - 1], data, path, options, rootData, context);
  }

  return validateInternal(TEMPLATE, data, path, options, rootData, context);
}

module.exports = class IamValidator {
  /**
   * Returns IamValidatorError class
   * @return {class} IamValidatorError
   * @constructor
   */
  static get IamValidatorError() {
    return IamValidatorError;
  }

  /**
   * Registers custom type validator
   * @param typeName
   * @param validator
   */
  static registerValidator(typeName, validator) {
    VALIDATORS.set(typeName, validator);
  }

  /**
   * Registers an alias for type validator
   * @param typeName
   * @param alias
   */
  static registerAlias(typeName, alias) {
    VALIDATORS.set(alias, VALIDATORS.get(typeName));
  }

  /**
   * Constructs validator bound to specified template
   * @param template template to be bound
   */
  constructor(template) {
    this.TEMPLATE = template;
  }

  /**
   * Validates data recursively
   * @param {array} data the testing data
   * @param {object} options options for validation
   * @return {array} source data (with defaults)
   * @throws IamValidatorError
   */
  validate(data, options = {}) {
    const path = options.arrayPathMode ? (options.path || ['_root']) : (options.path || '_root');
    return validate(this.TEMPLATE, data, path, options, data, options.context || {});
  }

  /**
   * Validates data recursively
   * @param {object} template source template
   * @param {array} data the testing data
   * @param {object} options options for validation
   * @return {array} source data (with defaults)
   * @throws IamValidatorError
   */
  static validate(template, data, options = {}) {
    const path = options.arrayPathMode ? (options.path || ['_root']) : (options.path || '_root');
    return validate(template, data, path, options, data, options.context || {});
  }
};
