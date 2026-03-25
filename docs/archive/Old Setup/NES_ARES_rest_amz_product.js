/**
 * Module Description
 * 
 * Version    Date            Author           Remarks
 * 1.00       26 Jan 2016     Steve
 *
 */

/**
 * @param {Object} dataIn Parameter object
 * @returns {Object} Output object
 */
function getRESTlet(dataIn) {
nlapiLogExecution('DEBUG', 'Restlet Start');
	var xml = '<?xml version="1.0" ?>' +
	'<AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="amznenvelope.xsd">'+
	'<Header>' +
	'<DocumentVersion>1.01</DocumentVersion>' +
	'<MerchantIdentifier>AKIAIVGMZZYWTTCL35KQ</MerchantIdentifier>' +
	'</Header>' +
	'<MessageType>Product</MessageType>' +
	'<PurgeAndReplace>false</PurgeAndReplace>';
	
var results = nlapiSearchRecord("item",null,
		[
			   ["custitem_update_amazon","is","T"]
			], 
			[
			   new nlobjSearchColumn("itemid").setSort(false), 
			   new nlobjSearchColumn("custrecord_ecomm_asin","CUSTRECORD_ECOMM_ITEM",null), 
			   new nlobjSearchColumn("custrecord_ecomm_listing_title","CUSTRECORD_ECOMM_ITEM",null), 
			   new nlobjSearchColumn("custrecord_ecomm_bullet_1","CUSTRECORD_ECOMM_ITEM",null), 
			   new nlobjSearchColumn("custrecord_ecomm_bullet_2","CUSTRECORD_ECOMM_ITEM",null), 
			   new nlobjSearchColumn("custrecord_ecomm_bullet_3","CUSTRECORD_ECOMM_ITEM",null), 
			   new nlobjSearchColumn("custrecord_ecomm_bullet_4","CUSTRECORD_ECOMM_ITEM",null), 
			   new nlobjSearchColumn("custrecord_ecomm_bullet_5","CUSTRECORD_ECOMM_ITEM",null),
			   new nlobjSearchColumn("custrecord_ecomm_prod_description","CUSTRECORD_ECOMM_ITEM",null),
			   new nlobjSearchColumn("custrecord_ecomm_search_terms","CUSTRECORD_ECOMM_ITEM",null), 
			   new nlobjSearchColumn("custrecord_ecomm_plantinum_words","CUSTRECORD_ECOMM_ITEM",null)
			]
			);
var z = 1;
for(var x in results)
{
var asin = results[x].getValue("custrecord_ecomm_asin","CUSTRECORD_ECOMM_ITEM");
if(asin == '' || asin == null)
{
  nlapiSubmitField('inventoryitem', results[x].getId(), 'custitem_update_amazon', 'F');
  continue;
}
var title = nlapiEscapeXML(results[x].getValue("custrecord_ecomm_listing_title","CUSTRECORD_ECOMM_ITEM"));
var bullet1 = nlapiEscapeXML(results[x].getValue("custrecord_ecomm_bullet_1","CUSTRECORD_ECOMM_ITEM"));
var bullet2 = nlapiEscapeXML(results[x].getValue("custrecord_ecomm_bullet_2","CUSTRECORD_ECOMM_ITEM"));
var bullet3 = nlapiEscapeXML(results[x].getValue("custrecord_ecomm_bullet_3","CUSTRECORD_ECOMM_ITEM"));
var bullet4 = nlapiEscapeXML(results[x].getValue("custrecord_ecomm_bullet_4","CUSTRECORD_ECOMM_ITEM"));
var bullet5 = nlapiEscapeXML(results[x].getValue("custrecord_ecomm_bullet_5","CUSTRECORD_ECOMM_ITEM"));
var prodDesc =  nlapiEscapeXML(results[x].getValue("custrecord_ecomm_prod_description","CUSTRECORD_ECOMM_ITEM"));
var searchTerm = nlapiEscapeXML(results[x].getValue("custrecord_ecomm_search_terms","CUSTRECORD_ECOMM_ITEM"));
var keyWord = nlapiEscapeXML(results[x].getValue("custrecord_ecomm_plantinum_words","CUSTRECORD_ECOMM_ITEM"));
var keyWordArr = keyWord.split(" ");
var itemId = results[x].getValue('itemid');
if(itemId.indexOf(":") != '-1')
	{
	var idArr = itemId.split(":");
	itemId = idArr[1];
	}
  
xml += '<Message>' +
	   '<MessageID>' + z + '</MessageID>' +
       '<OperationType>PartialUpdate</OperationType>' +
       '<Product>' +
       '<SKU> ' + itemId + '</SKU>' +
       '<StandardProductID>' +
       '<Type>ASIN</Type>' +
       '<Value>' + asin + '</Value>' +
       '</StandardProductID>' +
       '<NumberOfItems>1</NumberOfItems>' +
       '<DescriptionData>' +
       '<Title>' + title + '</Title>' +
       '<Description>' + prodDesc + '</Description>';

if(bullet1 != '' && bullet1 != null)
{xml += '<BulletPoint>' + bullet1 + '</BulletPoint>';}
if(bullet2 != '' && bullet2 != null)
{xml += '<BulletPoint>' + bullet2 + '</BulletPoint>';}
if(bullet3 != '' && bullet3 != null)
{xml += '<BulletPoint>' + bullet3 + '</BulletPoint>';}
if(bullet4 != '' && bullet4 != null)
{xml += '<BulletPoint>' + bullet4 + '</BulletPoint>';}
if(bullet5 != '' && bullet5 != null)
{xml += '<BulletPoint>' + bullet5 + '</BulletPoint>';}

if(searchTerm != '' && searchTerm != null)
	{
	xml += '<SearchTerms>' + searchTerm + '</SearchTerms>';
	}

var currentKW = '';
var tempKW = '';
var maxLn = 50;
if(keyWord != '' && keyWord != null)
	{
	for(var i = 0; i < keyWordArr.length; i++)
		{
                tempKW = currentKW + ' ' + keyWordArr[i];
                if(tempKW.length > maxLn || tempKW.length == maxLn)
               {
		xml += '<PlatinumKeywords>' + currentKW + '</PlatinumKeywords>';
		currentKW = keyWordArr[i];
		}
else
{currentKW = tempKW;}

	}
	}

 xml += '</DescriptionData>' +
        '</Product>' +
        '</Message>';
       
z++;
//nlapiSubmitField('inventoryitem', results[x].getId(), 'custitem_update_amazon', 'F');
}

xml += '</AmazonEnvelope>';

return xml;
}


function getPriceUpdate(dataIn) {
//	_POST_PRODUCT_PRICING_DATA_
	var xml = '<?xml version="1.0" ?>' +
	'<AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="amznenvelope.xsd">'+
	'<Header>' +
	'<DocumentVersion>1.01</DocumentVersion>' +
	'<MerchantIdentifier>AKIAIVGMZZYWTTCL35KQ</MerchantIdentifier>' +
	'</Header>' +
	'<MessageType>Price</MessageType>';

	
var results = nlapiSearchRecord("item",null,
		[
			   ["custitem_update_amazon_price","is","T"], 
			   "AND", 
   ["pricing.pricelevel","anyof","6"], 
   "AND", 
   ["pricing.currency","anyof","1"]
			], 
			[
				new nlobjSearchColumn("unitprice","pricing",null),
				new nlobjSearchColumn("itemid")
			]
			);
var z = 1;
for(var x in results)
{
if(x == 30){break;}
try{
var price = results[x].getValue("unitprice","pricing");
var itemId = results[x].getValue('itemid');
if(itemId.indexOf(":") != '-1')
	{
	var idArr = itemId.split(":");
	itemId = idArr[1];
	}
xml += '<Message>' +
	   '<MessageID>' + z + '</MessageID><Price>' +
       '<SKU>' + itemId + '</SKU>' +
       '<StandardPrice currency="USD">' + price + '</StandardPrice>';

 xml += '</Price></Message>';
nlapiSubmitField('inventoryitem', results[x].getId(), 'custitem_update_amazon_price', 'F');
z++;
} catch(e){nlapiLogExecution('ERROR', results[x].getId(), e.message);}


}

xml += '</AmazonEnvelope>';

return xml;
}


//
//<?xml version="1.0" ?>
//<AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="amznenvelope.xsd">
//<Header>
//<DocumentVersion>1.01</DocumentVersion>
//<MerchantIdentifier>AKIAIVGMZZYWTTCL35KQ</MerchantIdentifier>
//</Header>
//<MessageType>Product</MessageType>
//<PurgeAndReplace>false</PurgeAndReplace>
//<Message>
//<MessageID>1</MessageID>
//<OperationType>PartialUpdate</OperationType>
//<Product>
//<SKU>1Z-500ABR-TEST</SKU>
//<StandardProductID>
//<Type>UPC</Type>
//<Value>012345678901</Value>
//</StandardProductID>
//<NumberOfItems>1</NumberOfItems>
//<DescriptionData>
//<Title>A really cool product</Title>
//<Brand>ARES</Brand>
//<Description>A really cool product with 2 batteries and widgets</Description>
//<Manufacturer>ARES</Manufacturer>
//<MfrPartNumber>1Z-500ABR-TEST</MfrPartNumber>
//</DescriptionData>
//<ProductData>
//<Tools>
//<GritRating>55</GritRating>
//<Weight unitofMeasure="OZ">80</Weight>
//<Height unitofMeasure="FT">5</Height>
//<Width unitofMeasure="FT">7</Width>
//<Length unitofMeasure="FT">3</Length>
//</Tools>
//</ProductData>
//</Product>
//</Message>
//</AmazonEnvelope>
//
//
//<MessageType>Product</MessageType>
//<PurgeAndReplace>false</PurgeAndReplace>
//<Message>
//<MessageID>1</MessageID>
//<OperationType>Update</OperationType>
//<Product>
//<SKU>1Z-500ABR-TEST</SKU>
//<StandardProductID>
//<Type>0</Type>
//</StandardProductID>
//<ProductTaxCode>A_GEN_TAX</ProductTaxCode>
//<LaunchDate>2012-07-19T00:00:01</LaunchDate>
//<ReleaseDate>2012-07-19T00:00:01</ReleaseDate>
//<NumberOfItems>1</NumberOfItems>
//<DescriptionData>
//<Title>A really cool product</Title>
//<Brand>Bugs Bunny</Brand>
//<Description>A really cool product with 2 batteries and widgets</Description>
//<BulletPoint>Product Weight: 44 oz.</BulletPoint>
//<PackageWeight unitOfMeasure=�OZ�>44</PackageWeight>
//<MSRP currency=�USD�>219.00</MSRP>
//<Manufacturer>ACME</Manufacturer>
//<MfrPartNumber>123456789</MfrPartNumber>
//<SearchTerms>123456789</SearchTerms>
//<ItemType>crimpers</ItemType>
//<IsGiftWrapAvailable>false</IsGiftWrapAvailable>
//<IsGiftMessageAvailable>false</IsGiftMessageAvailable>
//</DescriptionData>
//<ProductData>
//<Tools>
//<GritRating>55</GritRating>
//</Tools>
//</ProductData>
//</Product>
//</Message>
//</AmazonEnvelope>