/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Error queue management for retry processing.
 *              Adds failed operations to a queue for automatic retry with exponential backoff.
 */
define(['N/record', 'N/search', 'N/log', './constants'], function (record, search, log, constants) {

    const EQ = constants.CUSTOM_RECORDS.ERROR_QUEUE;

    /**
     * Enqueues a failed operation for retry.
     * @param {Object} options
     * @param {string} options.type - Error type from ERROR_QUEUE_TYPE
     * @param {string} [options.recordType] - NS record type
     * @param {string} [options.recordId] - NS record ID
     * @param {string} [options.amazonRef] - Amazon reference ID
     * @param {string} options.errorMsg - Error message
     * @param {string} [options.payload] - Serialized data for retry
     * @param {string} [options.configId] - Config reference
     * @param {number} [options.maxRetries=3] - Max retry attempts
     * @param {number} [options.retryDelayMins=30] - Delay between retries in minutes
     * @returns {number} Error queue record ID
     */
    function enqueue(options) {
        // Check for existing pending entry with same ref to avoid duplicates
        if (options.amazonRef && isDuplicate(options.type, options.amazonRef)) {
            log.debug({
                title: 'Error Queue',
                details: 'Duplicate entry skipped: ' + options.type + ' / ' + options.amazonRef
            });
            return null;
        }

        const rec = record.create({ type: EQ.ID });
        rec.setValue({ fieldId: 'name', value: (options.type + ': ' + (options.amazonRef || options.recordId || 'unknown')).substring(0, 99) });
        rec.setValue({ fieldId: EQ.FIELDS.TYPE, value: options.type });
        rec.setValue({ fieldId: EQ.FIELDS.ERROR_MSG, value: (options.errorMsg || '').substring(0, 3999) });
        rec.setValue({ fieldId: EQ.FIELDS.STATUS, value: constants.ERROR_QUEUE_STATUS.PENDING });
        rec.setValue({ fieldId: EQ.FIELDS.RETRY_COUNT, value: 0 });
        rec.setValue({ fieldId: EQ.FIELDS.MAX_RETRIES, value: options.maxRetries || 3 });
        rec.setValue({ fieldId: EQ.FIELDS.CREATED, value: new Date() });

        const retryDelay = options.retryDelayMins || 30;
        rec.setValue({
            fieldId: EQ.FIELDS.NEXT_RETRY,
            value: new Date(Date.now() + retryDelay * 60 * 1000)
        });

        if (options.recordType) rec.setValue({ fieldId: EQ.FIELDS.RECORD_TYPE, value: options.recordType });
        if (options.recordId) rec.setValue({ fieldId: EQ.FIELDS.RECORD_ID, value: String(options.recordId) });
        if (options.amazonRef) rec.setValue({ fieldId: EQ.FIELDS.AMAZON_REF, value: options.amazonRef });
        if (options.payload) rec.setValue({ fieldId: EQ.FIELDS.PAYLOAD, value: options.payload });
        if (options.configId) rec.setValue({ fieldId: EQ.FIELDS.CONFIG, value: options.configId });

        return rec.save({ ignoreMandatoryFields: true });
    }

    /**
     * Gets all pending retry items that are due.
     * @returns {Array<Object>}
     */
    function getPendingRetries() {
        const items = [];
        const now = new Date();

        search.create({
            type: EQ.ID,
            filters: [
                [EQ.FIELDS.STATUS, 'anyof', [constants.ERROR_QUEUE_STATUS.PENDING, constants.ERROR_QUEUE_STATUS.RETRYING]],
                'AND',
                [EQ.FIELDS.NEXT_RETRY, 'onorbefore', now]
            ],
            columns: [
                EQ.FIELDS.TYPE,
                EQ.FIELDS.RECORD_TYPE,
                EQ.FIELDS.RECORD_ID,
                EQ.FIELDS.AMAZON_REF,
                EQ.FIELDS.PAYLOAD,
                EQ.FIELDS.RETRY_COUNT,
                EQ.FIELDS.MAX_RETRIES,
                EQ.FIELDS.CONFIG,
                EQ.FIELDS.ERROR_MSG
            ]
        }).run().each(function (result) {
            items.push({
                id: result.id,
                type: result.getValue(EQ.FIELDS.TYPE),
                recordType: result.getValue(EQ.FIELDS.RECORD_TYPE),
                recordId: result.getValue(EQ.FIELDS.RECORD_ID),
                amazonRef: result.getValue(EQ.FIELDS.AMAZON_REF),
                payload: result.getValue(EQ.FIELDS.PAYLOAD),
                retryCount: parseInt(result.getValue(EQ.FIELDS.RETRY_COUNT), 10) || 0,
                maxRetries: parseInt(result.getValue(EQ.FIELDS.MAX_RETRIES), 10) || 3,
                configId: result.getValue(EQ.FIELDS.CONFIG),
                errorMsg: result.getValue(EQ.FIELDS.ERROR_MSG)
            });
            return true;
        });

        return items;
    }

    /**
     * Marks an error queue item as resolved.
     */
    function markResolved(queueId) {
        record.submitFields({
            type: EQ.ID,
            id: queueId,
            values: { [EQ.FIELDS.STATUS]: constants.ERROR_QUEUE_STATUS.RESOLVED }
        });
    }

    /**
     * Updates retry count and schedules next retry with exponential backoff.
     * Marks as FAILED if max retries exceeded.
     */
    function incrementRetry(queueId, retryCount, maxRetries, newErrorMsg) {
        const nextCount = retryCount + 1;

        if (nextCount >= maxRetries) {
            record.submitFields({
                type: EQ.ID,
                id: queueId,
                values: {
                    [EQ.FIELDS.STATUS]: constants.ERROR_QUEUE_STATUS.FAILED,
                    [EQ.FIELDS.RETRY_COUNT]: nextCount,
                    [EQ.FIELDS.ERROR_MSG]: (newErrorMsg || '').substring(0, 3999)
                }
            });
            return;
        }

        // Exponential backoff: 30min, 60min, 120min, 240min...
        const delayMs = 30 * 60 * 1000 * Math.pow(2, nextCount);
        record.submitFields({
            type: EQ.ID,
            id: queueId,
            values: {
                [EQ.FIELDS.STATUS]: constants.ERROR_QUEUE_STATUS.RETRYING,
                [EQ.FIELDS.RETRY_COUNT]: nextCount,
                [EQ.FIELDS.NEXT_RETRY]: new Date(Date.now() + delayMs),
                [EQ.FIELDS.ERROR_MSG]: (newErrorMsg || '').substring(0, 3999)
            }
        });
    }

    /**
     * Checks for duplicate pending entry.
     */
    function isDuplicate(type, amazonRef) {
        let found = false;
        search.create({
            type: EQ.ID,
            filters: [
                [EQ.FIELDS.TYPE, 'is', type],
                'AND',
                [EQ.FIELDS.AMAZON_REF, 'is', amazonRef],
                'AND',
                [EQ.FIELDS.STATUS, 'anyof', [constants.ERROR_QUEUE_STATUS.PENDING, constants.ERROR_QUEUE_STATUS.RETRYING]]
            ],
            columns: ['internalid']
        }).run().each(function () {
            found = true;
            return false;
        });
        return found;
    }

    return {
        enqueue,
        getPendingRetries,
        markResolved,
        incrementRetry
    };
});
