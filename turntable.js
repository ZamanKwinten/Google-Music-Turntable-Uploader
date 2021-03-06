var library_node = null; // cached library dom node
//TODO datatable injection still needed?
var inject_files = [
    'DataTables-1.9.4/media/js/jquery.dataTables.js',
    'turntable_inject.js'
    ];

/*
 * Inject some javascript (as a string) into the DOM.
 */
function inject_code(code){
   var script = document.createElement('script');
   script.textContent = code;
   (document.head||document.documentElement).appendChild(script);
   script.parentNode.removeChild(script);
}

/*
 * Use the bscript to fetch a GM file, then trick Turntable into uploading it.
 * filename is a fake name to give to Turntable.
 */
function upload_track(id, filename){
    console.log('upload_track', id, filename);

    var track_button = $("button[data-id='" + id + "']");
    track_button.attr('disable', true);
    track_button.text('downloading');

    chrome.runtime.sendMessage({action: 'get_track_dataurl', id: id}, function(response) {
        var dataurl = response.dataurl;

        if(dataurl === null){
            // couldn't download -- quota exceeded?
           track_button.text("download error");
           return;
        }

        var code = '(' + function(inject_dataurl, inject_filename) {
            var blob = gmtt_dataurl_to_blob(inject_dataurl);

            /* spoof the File interface */
            blob.name = inject_filename;
            blob.lastModifiedDate = new Date();

            document.querySelector('input[type=file]').onchange.call({files:[blob]});

        } + ')' + 
            '(' + JSON.stringify(dataurl) +
            ',' + JSON.stringify(filename) + ')';

       inject_code(code);
    });
}

/*
 * Present the library to the user so they can choose songs to upload.
 */
function show_library(){
    console.log('show_library');
    // we may need to init our ui cache
    if(library_node === null){
        chrome.runtime.sendMessage({action: 'get_library'}, function(response) {
            refresh_ui_cache(response.library, _show_library);
        });
    } else {
        _show_library();
    }
}

/*
 * Shows the library, assuming that the library_node is created and cached.
 */
function _show_library(){
    console.log('_show_library');

    // reset to show the playlist queue
    // this allows users to see their uploaded song being uploaded
    $('#upload-pane .back').click();

    // insert into the dom in a random location, keeping it hidden.
    // we just need to be able to move it later from injected code.
    
    // need to operate on the parent; dataTable creates a wrapper
    library_node.parent().hide();
    library_node.parent().insertAfter($('#gmtt_show_library'));

    var code = '(' + function() {
        turntable.showAlert($('#gmtt_library').parent()[0]);
        $('#gmtt_library').parent().show();

        /* change their default modal styling */
        $('#overlay').find(':button.submit').text('close');
        $('#overlay').find('.modal').width(600);
    } + ')()';

    inject_code(code);

    // when the modal is closed, turntable.hideAlert() is called.
    // this destroys the library node; we need to keep a reference to it here.
}

/*
 * The library dom node is expensive to create.
 * This is called on library refreshes to cache the expensive datatables init,
 * and also handles races by disabling the show_library button.
 *
 * (optional) `callback` should take no arguments and can reference the global library_node.
 */
function refresh_ui_cache(library, callback){
    console.log('refresh_ui_cache', library, callback);
    present_show_button();

    var show_button = $('#gmtt_show_library');
    
    //TODO this disabling doesn't currently do anything
    show_button.attr('disable', true);
    show_button.text('Building library...');

    _cache_library_node(library, function() {
        show_button.attr('disable', false);
        show_button.text('Upload from Google Music');

        if(typeof callback !== "undefined"){
            callback();
        }
    });

}

function _cache_library_node(library, callback){
    console.log('_cache_library_node', library, callback);
    /* TODO
     * make cache keyset and display keyset user-configurable
     */

    /* setup the user-defined columns */
    var user_col_names = ['title', 'artist', 'album'];

    var song_arrays = library.map(function(song){
        var ar = [];
        ar.push(song.id); /* always have the id as first column */

        for(var i = 0; i < user_col_names.length; i++){
            ar.push(song[user_col_names[i]]);
        }
        return ar;
    });

    var dt_columns = user_col_names.map(function(col_name){
        return {
            'sTitle': col_name[0].toUpperCase() + col_name.slice(1)
        };
    });

    /* prepend the id column config.
     * each id row renders as a button that stores its id in `data-id`.
     */

    dt_columns.unshift({
        'sTitle': 'Id',
        'mRender': function(data, type, full){
            return '<button' +
                ' class="gmtt"' +
                ' data-id="' + data + '"' + 
                '>upload</button>';
        }
    });


    library_node = $('<table></table>');
    library_node.attr('id', 'gmtt_library');

    var dt_config = {
        'aaData': song_arrays,
        'aoColumns': dt_columns
    };

    // dataTable expects parent elements
    library_node.wrap('<div />');
    
    // TODO can this be async?
    // expensive and synchronous call
    library_node.dataTable(dt_config);

    library_node.on('click', ':button.gmtt', function(event){
        //TODO this is an assumption based on the order of cols
        var title = $(event.target).parent().siblings()[0].textContent;

        upload_track(event.target.getAttribute('data-id'), title + '.mp3');
        return false; // stop propogation
    });

    callback();
}

function present_show_button(){
    $('#gmtt_fetch_library').hide();
    $('#gmtt_show_library').show();
}

function present_fetch_button(){
    $('#gmtt_show_library').hide();
    $('#gmtt_fetch_library').text('Fetch Google Music library').show();
}

/*
 * Called once for init once turntable has set up their dom.
 */
function page_init(){
    // create/inject our button
    // TODO replicate mouseover style
    var tt_button = $('#plupload');

    var show_button = tt_button.clone();
    show_button.attr('id', 'gmtt_show_library');
    show_button.attr('style', window.getComputedStyle(tt_button[0], null).cssText);
    show_button.text('Upload from Google Music');
    show_button.click(show_library);

    var fetch_button = show_button.clone();
    fetch_button.attr('id', 'gmtt_fetch_library');
    fetch_button.text('Fetch Google Music library');
    fetch_button.click(function() {
        chrome.runtime.sendMessage({action: 'refresh_library'});
        fetch_button.text('(working...)');
    });

    show_button.hide();
    fetch_button.hide();
    show_button.insertAfter(tt_button);
    fetch_button.insertAfter(show_button);

    // set initial button state based on bscript library cache state.
    chrome.runtime.sendMessage({action: 'is_library_cached'}, function(response) {
        if (response.is_cached){
            present_show_button();
        } else {
            present_fetch_button();
        }
    });
}

function main(){
    chrome.runtime.sendMessage({action: 'show_page_action'});

    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        // the background script controls fetching the library.
        // we need to know when to invalidate our cached library_node.
        if (request.action == 'library_updated'){
            if (request.library === null){
                // signals that the cache has been cleared
                library_node = null;
                present_fetch_button();
            } else {
                refresh_ui_cache(request.library);
            }
        } else if(request.action == 'download_progress'){
            var button = $("button[data-id='" + request.id + "']");
            var new_text = Math.floor(request.percent) + "%";
            if(new_text == '100%'){
                new_text = 'queued';
            }

            button.text(new_text);
        } else if(request.action == 'invalid_auth'){
            present_fetch_button();
            alert('Please open Google Music in a tab before accessing your library.');
        }
    });

    // inject our files to use them as libraries later
    for(var i = 0; i < inject_files.length; i++){
        var s = document.createElement('script');
        //console.log('injecting', chrome.extension.getURL(inject_files[i]));
        s.src = chrome.extension.getURL(inject_files[i]);
        //TODO don't make functions in a loop
        s.onload = function() {
            this.parentNode.removeChild(this);
        };
        (document.head||document.documentElement).appendChild(s);
    }

    // turntable fires ready early, so we poll for the upload button
    (function(){
        if ($('#plupload').length > 0){
            page_init();
        } else {
            //TODO backoff
            setTimeout(arguments.callee,1000);
        }
    })();
}

main();
