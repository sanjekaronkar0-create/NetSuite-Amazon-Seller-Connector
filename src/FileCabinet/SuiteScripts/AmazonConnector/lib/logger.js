/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Centralized logging module for the Amazon Connector.
 *              Creates custom log records and writes to SuiteScript log.
 */
define(['N/record', 'N/log', './constants'], function (record, log, constants) {

    const CR = constants.CUSTOM_RECORDS.LOG;

    /**
     * Creates an integration log record.
     * @param {Object} options
     * @param {string} options.type - Log type from constants.LOG_TYPE
     * @param {string} options.status - Log status from constants.LOG_STATUS
     * @param {string} options.message - Summary message
     * @param {string} [options.details] - Full details / stack trace
     * @param {string} [options.recordType] - Related NS record type
     * @param {string} [options.recordId] - Related NS record internal ID
     * @param {string} [options.amazonRef] - Amazon reference ID
     * @param {string} [options.configId] - Config record internal ID
     */
    function createLog(options) {
        try {
            const logRec = record.create({ type: CR.ID });
            logRec.setValue({ fieldId: 'name', value: options.message.substring(0, 100) });
            logRec.setValue({ fieldId: CR.FIELDS.TYPE, value: options.type });
            logRec.setValue({ fieldId: CR.FIELDS.STATUS, value: options.status });
            logRec.setValue({ fieldId: CR.FIELDS.MESSAGE, value: options.message });
            logRec.setValue({ fieldId: CR.FIELDS.TIMESTAMP, value: new Date() });

            if (options.details) {
                logRec.setValue({ fieldId: CR.FIELDS.DETAILS, value: options.details });
            }
            if (options.recordType) {
                logRec.setValue({ fieldId: CR.FIELDS.RECORD_TYPE, value: options.recordType });
            }
            if (options.recordId) {
                logRec.setValue({ fieldId: CR.FIELDS.RECORD_ID, value: String(options.recordId) });
            }
            if (options.amazonRef) {
                logRec.setValue({ fieldId: CR.FIELDS.AMAZON_REF, value: options.amazonRef });
            }
            if (options.configId) {
                logRec.setValue({ fieldId: CR.FIELDS.CONFIG, value: options.configId });
            }

            return logRec.save({ ignoreMandatoryFields: true });
        } catch (e) {
            log.error({ title: 'Logger.createLog Error', details: e.message });
            return null;
        }
    }

    /**
     * Logs a successful event.
     */
    function success(type, message, options) {
        log.audit({ title: 'AMZ Connector [SUCCESS]', details: message });
        return createLog(Object.assign({ type, status: constants.LOG_STATUS.SUCCESS, message }, options || {}));
    }

    /**
     * Logs an error event.
     */
    function error(type, message, options) {
        log.error({ title: 'AMZ Connector [ERROR]', details: message });
        return createLog(Object.assign({ type, status: constants.LOG_STATUS.ERROR, message }, options || {}));
    }

    /**
     * Logs a warning event.
     */
    function warn(type, message, options) {
        log.audit({ title: 'AMZ Connector [WARNING]', details: message });
        return createLog(Object.assign({ type, status: constants.LOG_STATUS.WARNING, message }, options || {}));
    }

    /**
     * Logs an in-progress event.
     */
    function progress(type, message, options) {
        log.audit({ title: 'AMZ Connector [IN PROGRESS]', details: message });
        return createLog(Object.assign({ type, status: constants.LOG_STATUS.IN_PROGRESS, message }, options || {}));
    }

    return {
        createLog,
        success,
        error,
        warn,
        progress
    };
});
