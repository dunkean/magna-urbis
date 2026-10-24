extends SceneTree
const LogQueue=preload("res://adapters/surface_native_log.gd")
var checks=0
func check(value:bool,label:String):
	checks+=1
	if not value:push_error(label);quit(1)
func _initialize():
	var real=LogQueue.new();check(real.start()==OK,"real writer starts")
	for i in 300:check(real.enqueue(JSON.stringify({"event":"logger-fixture","serial":i,"unicode":"é源😀","payload":"first\nsecond","capturedTick":i}),"fixture"),"real UTF8 line accepted")
	real.flush();var stats=real.snapshot()
	check(stats.written==300 and stats.pending==0 and stats.pendingUtf8Bytes==0,"flush waits for real output")
	real.close();check(real.snapshot().closed and real.snapshot().joined,"close joins writer")
	check(not real.enqueue("after-close"),"closed writer rejects new output")
	check(real.snapshot().rejected==1 and real.snapshot().failure.is_empty(),"closed rejection is disclosed")
	# Block only the test sink, prove snapshot/mutex remains usable during I/O,
	# and exercise independent byte-cap and message-cap pressure.
	for message_cap in [false,true]:
		var writer=LogQueue.new();var entered=Semaphore.new();var release=Semaphore.new();var received:Array=[]
		var sink=func(text:String):
			if received.is_empty():entered.post();release.wait()
			# Would deadlock if the writer held its queue mutex around I/O.
			var snapshot=writer.snapshot();assert(snapshot.inFlight)
			received.append(text)
		check(writer.start(1048576 if message_cap else 128,2 if message_cap else 10,sink)==OK,"pressure writer starts")
		var first="源".repeat(20);var second="b".repeat(60)
		check(writer.enqueue(first,"pressure"),"first pressure line accepted");entered.wait()
		check(writer.enqueue(second,"pressure"),"second pressure line accepted")
		check(not writer.enqueue("c".repeat(60),"pressure"),"bounded pressure fails closed")
		var state=writer.snapshot()
		check(state.accepted==2 and state.rejected==1 and not state.accepting,"overflow rejects, never silently drops")
		check(state.pending==2 and state.maximumPendingUtf8Bytes<=state.capacityUtf8Bytes,"in-flight bytes count against bound")
		check(state.failure=="native log queue overflow","overflow failure exposed")
		release.post();writer.close();state=writer.snapshot()
		check(received==[first,second],"accepted FIFO text remains exact under pressure")
		check(state.written==2 and state.pending==0 and state.joined,"overflow still drains accepted messages before join")
	var records:Array=[];var logger=LogQueue.new();check(logger.start(1048576,1024,func(text:String):records.append(text))==OK,"bounded stats writer starts")
	for i in 550:check(logger.enqueue(str(i),"unique-event-"+str(i)),"stats fixture accepted")
	logger.flush();check(records.size()==550,"flush complete without closing")
	check(logger.enqueue("after-flush","last"),"writer reusable after flush");logger.close();stats=logger.snapshot()
	check(records.back()=="after-flush" and stats.written==551,"close flushes subsequent messages")
	for i in 550:check(records[i]==str(i),"FIFO ordering")
	check(stats.recent.size()==512 and stats.maximaByEvent.size()<=64,"metrics history and event buckets bounded")
	check(stats.recent.back().has("printWallMs") and stats.recent.back().has("queueWaitMs") and not stats.recent.back().has("enqueueMs"),"writer timing labels are explicit")
	check(logger.start()==ERR_ALREADY_IN_USE,"closed instance cannot start another writer")
	var invalid=LogQueue.new();check(invalid.start(0,10)==ERR_INVALID_PARAMETER,"invalid cap rejected before thread")
	# Execute the actual production emitter body in a minimal RefCounted host.
	# No renderer/source setup is needed, and the test does not duplicate its code.
	var main_source=FileAccess.get_file_as_string("res://scene/main.gd").replace("\r","")
	var begin=main_source.find("func _emit_native(");var end=main_source.find("\nfunc _quantile",begin)
	var script=GDScript.new()
	script.source_code="extends RefCounted\nvar native_log_mode='synchronous'\nvar native_logger=null\nvar native_log_timings=[]\nvar native_log_maxima={}\nvar native_log_failed=false\nfunc get_tree():return null\n"+main_source.substr(begin,end-begin)
	check(script.reload()==OK,"production emitter compiles in CPU host")
	var host=script.new();var emitted:Array=[];var queue=LogQueue.new()
	check(queue.start(65536,16,func(text:String):emitted.append(text))==OK,"emitter queue starts")
	host.native_log_mode="threaded";host.native_logger=queue
	var event={"event":"native-emit-fixture","tickMs":123.5,"nested":{"value":"before"}}
	host.call("_emit_native",event);event.nested.value="after"
	queue.close()
	var decoded=JSON.parse_string(emitted[0])
	check(decoded.tickMs==123.5 and decoded.nested.value=="before","clock/payload frozen before enqueue")
	check(decoded.unixTimeMs>0,"main emitter captures UTC before queue")
	check(host.native_log_timings[0].has("enqueueMs") and not host.native_log_timings[0].has("printMs"),"threaded main labels enqueue separately")
	check(host.native_log_maxima["native-emit-fixture"].has("enqueueMs"),"threaded maxima keys")
	var sync_host=script.new();sync_host.call("_emit_native",{"event":"native-sync-fixture"})
	check(sync_host.native_log_timings[0].has("printMs") and not sync_host.native_log_timings[0].has("enqueueMs"),"synchronous v1 printMs preserved")
	print(JSON.stringify({"event":"native-log-test-report","status":"PASS","checks":checks,"realWriter":real.snapshot(),"boundedStats":{"recent":stats.recent.size(),"eventBuckets":stats.maximaByEvent.size(),"accepted":stats.accepted,"written":stats.written},"scope":"CPU threaded queue, real stdout UTF8, pressure/failure, FIFO/flush/join; no navigation performance claim"}));quit()

