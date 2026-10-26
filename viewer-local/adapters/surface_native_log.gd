class_name SurfaceNativeLog
extends RefCounted
# Main-owner API: start/enqueue/flush/close. Only the writer thread calls the sink.
# Capacity includes the in-flight message. UTF8 bytes are a transport bound, not RSS.
const VERSION="surface-native-log-1"
const DEFAULT_MAX_BYTES=16*1024*1024
const DEFAULT_MAX_MESSAGES=8192
const RECENT_LIMIT=512
var _mutex=Mutex.new()
var _wake=Semaphore.new()
var _flushed=Semaphore.new()
var _thread:Thread
var _sink:Callable
var _injected_sink=false
var _started_once=false
var _queue:Array=[]
var _head=0
var _accepting=false
var _closing=false
var _closed=false
var _joined=false
var _flush_waiting=false
var _max_bytes=DEFAULT_MAX_BYTES
var _max_messages=DEFAULT_MAX_MESSAGES
var _accepted=0
var _written=0
var _rejected=0
var _pending=0
var _pending_bytes=0
var _maximum_pending=0
var _maximum_pending_bytes=0
var _inflight=false
var _failure=""
var _recent:Array=[]
var _maxima:Dictionary={}
var _last_written=0

func start(max_bytes:int=DEFAULT_MAX_BYTES,max_messages:int=DEFAULT_MAX_MESSAGES,sink:Callable=Callable())->Error:
	if _started_once:return ERR_ALREADY_IN_USE
	if max_bytes<1 or max_messages<1:return ERR_INVALID_PARAMETER
	_started_once=true;_max_bytes=max_bytes;_max_messages=max_messages;_sink=sink;_injected_sink=sink.is_valid();_accepting=true
	_thread=Thread.new()
	var error=_thread.start(_write_loop)
	if error!=OK:
		_accepting=false;_closed=true;_joined=true;_failure="writer thread could not start"
		_sink=Callable();_thread=null
	return error

func enqueue(text:String,event_name:String="unknown")->bool:
	var bytes=text.to_utf8_buffer().size()+1 # print adds a newline
	_mutex.lock()
	if not _accepting:
		_rejected+=1;_mutex.unlock();return false
	if bytes>_max_bytes-_pending_bytes or _pending>=_max_messages:
		_rejected+=1;_failure="native log queue overflow";_accepting=false;_closing=true
		_mutex.unlock();_wake.post();return false
	_accepted+=1;_pending+=1;_pending_bytes+=bytes
	_maximum_pending=maxi(_maximum_pending,_pending);_maximum_pending_bytes=maxi(_maximum_pending_bytes,_pending_bytes)
	_queue.append({"text":text,"bytes":bytes,"event":event_name.left(128),"serial":_accepted,"queuedUs":Time.get_ticks_usec()})
	_mutex.unlock();_wake.post();return true

func _write_loop():
	while true:
		_wake.wait()
		_mutex.lock()
		if _head>=_queue.size():
			var stop=_closing
			if stop:_closed=true
			_mutex.unlock()
			if stop:return
			continue
		var item:Dictionary=_queue[_head];_queue[_head]=null;_head+=1;_inflight=true
		if _head==_queue.size():_queue.clear();_head=0
		elif _head>=256 and _head*2>=_queue.size():_queue=_queue.slice(_head);_head=0
		_mutex.unlock()
		var before=Time.get_ticks_usec()
		# Never hold the queue mutex during blocking output or an injected test sink.
		if _sink.is_valid():_sink.call(item.text)
		else:print(item.text)
		var after=Time.get_ticks_usec()
		var timing={"serial":item.serial,"event":item.event,"queuedUs":item.queuedUs,"beforePrintUs":before,"afterPrintUs":after,"queueWaitMs":(before-int(item.queuedUs))/1000.0,"printWallMs":(after-before)/1000.0,"utf8Bytes":item.bytes}
		_mutex.lock()
		_written+=1;_last_written=int(item.serial);_pending-=1;_pending_bytes-=int(item.bytes);_inflight=false
		_recent.append(timing)
		if _recent.size()>RECENT_LIMIT:_recent.pop_front()
		var key=str(item.event)
		if not _maxima.has(key) and _maxima.size()>=63:key="other-events"
		var maximum:Dictionary=_maxima.get(key,{"count":0,"printWallMs":0.0,"queueWaitMs":0.0})
		maximum.count+=1;maximum.printWallMs=maxf(maximum.printWallMs,float(timing.printWallMs));maximum.queueWaitMs=maxf(maximum.queueWaitMs,float(timing.queueWaitMs));_maxima[key]=maximum
		var signal_flush=_flush_waiting;_flush_waiting=false
		_mutex.unlock()
		if signal_flush:_flushed.post()

# Only the owning main thread calls flush/close; no per-frame or input flush.
# This waits for all messages accepted before the call, without holding a mutex.
func flush()->void:
	_mutex.lock();var target=_accepted;_mutex.unlock()
	while true:
		_mutex.lock()
		if _last_written>=target:_mutex.unlock();return
		_flush_waiting=true;_mutex.unlock();_flushed.wait()

func close()->void:
	if _thread==null or _joined:return
	_mutex.lock();_accepting=false;_closing=true;_mutex.unlock();_wake.post()
	flush();_thread.wait_to_finish();_joined=true
	# Release callable captures and the completed Thread after joining.
	_sink=Callable();_thread=null

func snapshot()->Dictionary:
	_mutex.lock()
	var result={"version":VERSION,"mode":"threaded","sink":"injected-test" if _injected_sink else "stdout","capacityUtf8Bytes":_max_bytes,"capacityMessages":_max_messages,"accepted":_accepted,"written":_written,"lastWrittenSerial":_last_written,"rejected":_rejected,"pending":_pending,"pendingUtf8Bytes":_pending_bytes,"queueDepth":_queue.size()-_head,"inFlight":_inflight,"maximumPending":_maximum_pending,"maximumPendingUtf8Bytes":_maximum_pending_bytes,"accepting":_accepting,"closing":_closing,"closed":_closed,"joined":_joined,"failure":_failure,"maximaByEvent":_maxima.duplicate(true),"recent":_recent.duplicate(true),"scope":"Writer printWallMs and queued-to-print queueWaitMs; wall spans are not CPU attribution. Snapshot excludes its own later report line. Flush/close may wait for underlying output only outside input."}
	_mutex.unlock();return result
